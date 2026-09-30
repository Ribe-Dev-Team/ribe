import { planExpiry, planMatchWrite, MatchWrite, StoredOffer, StoredRequest, toMatchWrites } from '../src/writes';
import { ProposedMatch } from '../src/match';
import { makeOffer, CAMPUS } from './fixtures';

const matchedAt = new Date('2026-10-04T20:00:00Z');
const acceptDeadline = new Date('2026-10-04T21:00:00Z');

const write: MatchWrite = {
  reqId: 'r', offerId: 'o', driverId: 'd', matchedAt, acceptDeadline,
  riderDetourMinutes: 3.5, routeIndex: 1, baseline: ['c1', 'c2'],
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
          riderDetourMinutes: 3.5, routeIndex: 1,
        },
        remove: [],
      },
      offer: { set: { status: 'awaiting', pendingRequestId: 'r', matchedAt, acceptDeadline }, remove: [] },
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
      driverAddedMinutes: 2, offerScore: 1, reqScore: 1, finalArrival: matchedAt, totalTripMinutes: 30,
      matchedAt, acceptDeadline,
    } as ProposedMatch;
    expect(toMatchWrites([m], [o])).toEqual([write]);
  });
});

describe('planExpiry', () => {
  const now = new Date('2026-10-04T22:00:00Z');
  const overdue: StoredRequest = { status: 'awaiting', matchedOfferId: 'o', acceptDeadline };
  const holding: StoredOffer = { ...offer, status: 'awaiting', pendingRequestId: 'r' };

  it("expires the request and frees the driver's slot", () => {
    expect(planExpiry('r', overdue, holding, now)).toEqual({
      request: { set: { status: 'expired' }, remove: [] },
      offer: { set: { status: 'pending', pendingRequestId: null }, remove: ['matchedAt', 'acceptDeadline'] },
    });
  });

  it('leaves a slot alone once it belongs to someone else', () => {
    expect(planExpiry('r', overdue, { ...holding, pendingRequestId: 'other' }, now)).toEqual({
      request: { set: { status: 'expired' }, remove: [] },
    });
  });

  it('does nothing before the deadline, or to a request not awaiting approval', () => {
    expect(planExpiry('r', overdue, holding, new Date(acceptDeadline.getTime() - 1))).toBeNull();
    expect(planExpiry('r', { ...overdue, status: 'confirmed' }, holding, now)).toBeNull();
    expect(planExpiry('r', { status: 'awaiting' }, holding, now)).toBeNull();
  });
});
