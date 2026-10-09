/*
Tests src/writes.ts - deciding what to change in Firestore, without Firestore.
runner/firestore.ts makes these same decisions inside its transactions.

  planMatchWrite   a new match moves rider and driver to 'awaiting', or is
                   refused if the documents changed since the run read them
                   (rider gone or cancelled, slot taken, confirmed riders
                   changed or reordered, car full)
  toMatchWrites    a matcher result becomes a write, carrying the rider's
                   pickup position, the confirmed riders it was planned around,
                   and the car's timetable if the rider accepts
  planSettle       a matched request catches up with its offer: back to the
                   pool if the driver removed the offer, expired (freeing the
                   slot) if the rider didn't answer by the deadline
*/

import { OFFER_SLOT_FIELDS, planMatchWrite, planScheduleWrite, planSettle, MatchWrite, REQUEST_MATCH_FIELDS, ScheduleWrite, settledOfferStatus, StoredOffer, StoredRequest, toMatchWrites } from '../../matching/src/writes';
import { ProposedMatch } from '../../matching/src/types';
import { makeOffer, CAMPUS } from '../fixtures';

const matchedAt = new Date('2026-10-04T20:00:00Z');
const acceptDeadline = new Date('2026-10-04T21:00:00Z');

const departAt = new Date('2026-10-04T21:45:00Z');
const at = (min: number) => new Date(departAt.getTime() + min * 60_000);

const write: MatchWrite = {
  reqId: 'r', offerId: 'o', riderId: 'rider', driverId: 'd', matchedAt, acceptDeadline,
  riderDetourMinutes: 3.5, routeIndex: 1, baseline: ['c1', 'c2'],
  pickupAt: at(15), arriveAt: at(30),
  schedule: {
    departAt,
    arriveAt: at(30),
    stops: [
      { requestId: 'c1', pickupAt: at(5), arriveAt: at(30) },
      { requestId: 'r', pickupAt: at(15), arriveAt: at(30) },
      { requestId: 'c2', pickupAt: at(20), arriveAt: at(30) },
    ],
  },
};
const request: StoredRequest = { status: 'pending' };
const offer: StoredOffer = { status: 'pending', seatCapacity: 4, pendingRequestId: null, confirmedRequestIds: ['c1', 'c2'] };

describe('planMatchWrite', () => {
  it('moves both sides to awaiting and records the pickup position', () => {
    const plan = planMatchWrite(request, offer, write);
    expect(plan).toEqual({
      ok: true,
      request: {
        set: {
          status: 'awaiting', matchedOfferId: 'o', matchedDriverId: 'd', matchedAt, acceptDeadline,
          riderDetourMinutes: 3.5, routeIndex: 1, pickupAt: at(15), arriveAt: at(30),
        },
        remove: [],
      },
      offer: {
        set: {
          status: 'awaiting', pendingRequestId: 'r', matchedRiderId: 'rider', matchedAt, acceptDeadline,
          pendingSchedule: write.schedule,
        },
        remove: [],
      },
    });
  });

  it.each<[string, StoredRequest | undefined, StoredOffer | undefined, string]>([
    ['a document is gone', undefined, offer, 'MISSING'],
    ['the rider was matched or cancelled meanwhile', { status: 'awaiting' }, offer, 'REQUEST_NOT_PENDING'],
    ['the driver cancelled or filled up', request, { ...offer, status: 'confirmed' }, 'OFFER_NOT_PENDING'],
    ["the driver's slot was taken by another run", request, { ...offer, pendingRequestId: 'x' }, 'SLOT_TAKEN'],
    ['a confirmed rider changed under the route', request, { ...offer, confirmedRequestIds: ['c1'] }, 'BASELINE_CHANGED'],
    ['the confirmed riders were reordered', request, { ...offer, confirmedRequestIds: ['c2', 'c1'] }, 'BASELINE_CHANGED'],
    ['every seat is taken', request, { ...offer, seatCapacity: 2 }, 'FULL'],
    ['the driver locked the trip', request, { ...offer, acceptingMore: false }, 'LOCKED'],
  ])('refuses when %s', (_why, req, off, reason) => {
    expect(planMatchWrite(req, off, write)).toEqual({ ok: false, reason });
  });
});

describe('toMatchWrites', () => {
  it("carries the insertion index and the offer's confirmed baseline", () => {
    const o = makeOffer({
      offerId: 'o', start: CAMPUS,
      onBoard: [
        { reqId: 'c1', riderId: 'x', waypoint: CAMPUS, arriveBy: matchedAt, maxDetour: 5, currentDetour: 0 },
        { reqId: 'c2', riderId: 'y', waypoint: CAMPUS, arriveBy: matchedAt, maxDetour: 5, currentDetour: 0 },
      ],
    });
    const m = {
      offerId: 'o', reqId: 'r', riderId: 'rider', driverId: 'd', insertionIndex: 1, riderDetour: 3.5,
      driverAddedMinutes: 2, offerScore: 1, reqScore: 1, departAt, finalArrival: at(30), totalTripMinutes: 30,
      pickupAt: at(15), arriveAt: at(30),
      schedule: [
        { reqId: 'c1', pickupAt: at(5), arriveAt: at(30) },
        { reqId: 'r', pickupAt: at(15), arriveAt: at(30) },
        { reqId: 'c2', pickupAt: at(20), arriveAt: at(30) },
      ],
      matchedAt, acceptDeadline,
    } as ProposedMatch;
    expect(toMatchWrites([m], [o])).toEqual([write]);
  });
});

describe('planSettle', () => {
  const now = new Date('2026-10-04T22:00:00Z');
  const before = new Date(acceptDeadline.getTime() - 1);
  const overdue: StoredRequest = { status: 'awaiting', matchedOfferId: 'o', acceptDeadline };
  const holding: StoredOffer = { ...offer, status: 'awaiting', pendingRequestId: 'r' };
  const released = { outcome: 'RELEASED', request: { set: { status: 'pending' }, remove: REQUEST_MATCH_FIELDS } };

  it("expires an unanswered match and frees the driver's slot", () => {
    expect(planSettle('r', overdue, holding, now)).toEqual({
      outcome: 'EXPIRED',
      request: { set: { status: 'expired' }, remove: [] },
      offer: { set: { status: 'pending', pendingRequestId: null }, remove: OFFER_SLOT_FIELDS },
    });
  });

  it('returns a rider awaiting approval to the pool when the driver removed the offer', () => {
    expect(planSettle('r', overdue, { ...holding, status: 'cancelled' }, before)).toEqual(released);
    expect(planSettle('r', overdue, undefined, before)).toEqual(released);
    expect(planSettle('r', overdue, { ...holding, pendingRequestId: 'other' }, before)).toEqual(released);
  });

  it('returns a confirmed rider to the pool when the driver removed the offer', () => {
    const confirmed: StoredRequest = { status: 'confirmed', matchedOfferId: 'o' };
    const seated: StoredOffer = { ...offer, confirmedRequestIds: ['c1', 'r'] };
    expect(planSettle('r', confirmed, seated, now)).toBeNull();
    expect(planSettle('r', confirmed, { ...seated, status: 'cancelled' }, now)).toEqual(released);
    expect(planSettle('r', confirmed, undefined, now)).toEqual(released);
  });

  it('waits while the rider still has time, and ignores requests not matched', () => {
    expect(planSettle('r', overdue, holding, before)).toBeNull();
    expect(planSettle('r', { status: 'awaiting', matchedOfferId: 'o' }, holding, now)).toBeNull();
    expect(planSettle('r', { status: 'cancelled' }, undefined, now)).toBeNull();
    expect(planSettle('r', { status: 'pending' }, undefined, now)).toBeNull();
  });
});

describe('settledOfferStatus — a driver locking their trip', () => {
  const car = (p: Partial<StoredOffer>): StoredOffer => ({ status: 'pending', seatCapacity: 4, ...p });

  it('keeps an unlocked car with room in the pool', () => {
    expect(settledOfferStatus(car({ confirmedRequestIds: ['a'] }))).toBe('pending');
  });

  it('finishes a car that is full, locked or not', () => {
    expect(settledOfferStatus(car({ seatCapacity: 1, confirmedRequestIds: ['a'] }))).toBe('confirmed');
  });

  it('finishes a locked car with passengers, even with seats free', () => {
    expect(settledOfferStatus(car({ confirmedRequestIds: ['a'], acceptingMore: false }))).toBe('confirmed');
  });

  it('leaves a locked car with nobody aboard as it was - there is no trip to finish', () => {
    expect(settledOfferStatus(car({ confirmedRequestIds: [], acceptingMore: false }))).toBe('pending');
  });

  it('keeps a locked car finished when an unanswered match expires', () => {
    const plan = planSettle(
      'r',
      { status: 'awaiting', matchedOfferId: 'o', acceptDeadline },
      car({ status: 'awaiting', pendingRequestId: 'r', confirmedRequestIds: ['a'], acceptingMore: false }),
      new Date(acceptDeadline.getTime() + 1),
    );
    expect(plan?.offer?.set.status).toBe('confirmed');
  });
});

describe('planScheduleWrite — filling in a confirmed car timetable', () => {
  const w: ScheduleWrite = { offerId: 'o', baseline: ['c1', 'c2'], schedule: write.schedule };

  it('writes it while the car still carries exactly those riders', () => {
    expect(planScheduleWrite(offer, w)).toEqual({ set: { schedule: write.schedule }, remove: [] });
    // A rider deciding on a new match doesn't matter: that's pendingSchedule.
    expect(planScheduleWrite({ ...offer, status: 'awaiting', pendingRequestId: 'r' }, w)).not.toBeNull();
  });

  it("doesn't write it once the riders changed, or the drive was removed", () => {
    expect(planScheduleWrite({ ...offer, confirmedRequestIds: ['c1'] }, w)).toBeNull();
    expect(planScheduleWrite({ ...offer, status: 'cancelled' }, w)).toBeNull();
    expect(planScheduleWrite(undefined, w)).toBeNull();
  });
});
