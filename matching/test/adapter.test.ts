import {
  batchPoints, groupIntoBatches, MONASH_CLAYTON as CAMPUS, OfferDoc, RequestDoc, toMatchInputs,
} from '../src/adapter';
import { zonedDateTime } from '../src/melbourneTime';
import { deriveRiderMaxDetour } from '../src/riderPolicy';
import { evaluateRoute } from '../src/route';
import { SyntheticTravelTime } from '../src/travelTime';
import { DEFAULT_CONFIG } from '../src/types';

// 60 km/h over straight lines, no noise: one minute per km, easy to reason about.
const t = new SyntheticTravelTime({ roadFactor: 1, avgSpeedKmh: 60, jitter: 0 });
const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });

const NOW = new Date('2026-10-01T00:00:00Z');
/** What the app stores for a travel date: the phone's local midnight. */
const stored = (day: number, month = 10) => zonedDateTime({ year: 2026, month, day }, '00:00');
const melb = (day: number, hhmm: string) => zonedDateTime({ year: 2026, month: 10, day }, hhmm);

function reqDoc(p: Partial<RequestDoc> & { id: string }): RequestDoc {
  return {
    userId: 'rider-' + p.id, status: 'pending', toUni: true, coord: north(8),
    date: stored(5), departureTime: '08:00', arrivalTime: '09:00', ...p,
  };
}

function offerDoc(p: Partial<OfferDoc> & { id: string }): OfferDoc {
  return {
    userId: 'driver-' + p.id, status: 'pending', toUni: true, coord: north(20),
    date: stored(5), departureTime: '08:00', arrivalTime: '09:00',
    maxDetourTime: 20, seatCapacity: 3, pendingRequestId: null, confirmedRequestIds: [], ...p,
  };
}

describe('groupIntoBatches', () => {
  it('batches by Melbourne date and direction, sorted by key', () => {
    const { batches, skipped } = groupIntoBatches(
      [reqDoc({ id: 'a' }), reqDoc({ id: 'b', date: stored(6) }), reqDoc({ id: 'c', toUni: false })],
      [offerDoc({ id: 'd' })],
      NOW,
    );
    expect(skipped).toEqual([]);
    expect(batches.map((b) => b.batchKey)).toEqual([
      '2026-10-05_FROM_CAMPUS', '2026-10-05_TO_CAMPUS', '2026-10-06_TO_CAMPUS',
    ]);
    expect(batches[1].requests.map((r) => r.id)).toEqual(['a']);
    expect(batches[1].offers.map((o) => o.id)).toEqual(['d']);
  });

  it('files a stored local midnight under the intended day, not the UTC day before', () => {
    const { batches } = groupIntoBatches([reqDoc({ id: 'a', date: new Date('2026-10-04T13:00:00Z') })], [], NOW);
    expect(batches[0].batchKey).toBe('2026-10-05_TO_CAMPUS');
  });

  it('leaves out, with a reason, every booking the matcher must not touch', () => {
    const { batches, skipped } = groupIntoBatches(
      [
        reqDoc({ id: 'matched', status: 'awaiting' }),
        reqDoc({ id: 'nowhere', coord: undefined }),
        reqDoc({ id: 'garbled', arrivalTime: '9am' }),
        reqDoc({ id: 'undated', date: new Date(NaN) }),
        reqDoc({ id: 'over', date: stored(30, 9) }),
      ],
      [
        offerDoc({ id: 'busy', pendingRequestId: 'someone' }),
        offerDoc({ id: 'gone', date: stored(1), departureTime: '08:00' }), // 08:00 on 1 Oct - before NOW's 10:00
      ],
      NOW,
    );
    expect(batches).toEqual([]);
    expect(skipped).toEqual([
      { kind: 'request', id: 'matched', reason: 'NOT_MATCHABLE' },
      { kind: 'request', id: 'nowhere', reason: 'NO_COORD' },
      { kind: 'request', id: 'garbled', reason: 'BAD_TIME' },
      { kind: 'request', id: 'undated', reason: 'BAD_TIME' },
      { kind: 'request', id: 'over', reason: 'DEPARTED' },
      { kind: 'offer', id: 'busy', reason: 'SLOT_TAKEN' },
      { kind: 'offer', id: 'gone', reason: 'DEPARTED' },
    ]);
  });
});

describe('toMatchInputs', () => {
  const batchOf = (requests: RequestDoc[], offers: OfferDoc[]) =>
    groupIntoBatches(requests, offers, NOW).batches[0];

  it('builds a to-campus rider: window, arrival and derived detour cap', () => {
    const { requests } = toMatchInputs(batchOf([reqDoc({ id: 'r' })], []), new Map(), t);
    const r = requests[0];
    const direct = t.minutes(north(8), CAMPUS);

    expect(r).toMatchObject({ reqId: 'r', riderId: 'rider-r', direction: 'TO_CAMPUS', status: 'unassigned' });
    expect(r.start).toEqual(north(8));
    expect(r.end).toEqual(CAMPUS);
    expect(r.arriveBy).toEqual(melb(5, '09:00'));
    expect(r.travelWindow.start).toEqual(melb(5, '08:00'));
    // Latest departure that still arrives by 9:00 going direct.
    expect(r.travelWindow.end.getTime()).toBeCloseTo(melb(5, '09:00').getTime() - direct * 60_000, -1);
    expect(r.maxDetour).toBeCloseTo(deriveRiderMaxDetour(direct, DEFAULT_CONFIG));
  });

  it('builds a from-campus rider leaving campus for home', () => {
    const { requests } = toMatchInputs(batchOf([reqDoc({ id: 'r', toUni: false })], []), new Map(), t);
    expect(requests[0].direction).toBe('FROM_CAMPUS');
    expect(requests[0].start).toEqual(CAMPUS);
    expect(requests[0].end).toEqual(north(8));
  });

  it("caps a driver's detour by what their own arrival time leaves over", () => {
    // 20 min drive in a 25 min window: only 5 of the offered 20 are usable.
    const doc = offerDoc({ id: 'o', departureTime: '08:00', arrivalTime: '08:25' });
    const { offers } = toMatchInputs(batchOf([], [doc]), new Map(), t);
    expect(offers[0].maxDetour).toBeCloseTo(25 - t.minutes(north(20), CAMPUS));
    expect(offers[0].maxDetour).toBeLessThan(20);
  });

  it('keeps the offered detour when the window has room for it', () => {
    const { offers } = toMatchInputs(batchOf([], [offerDoc({ id: 'o' })]), new Map(), t);
    expect(offers[0].maxDetour).toBe(20);
  });

  it("sets a driver's window to when the car could reach a rider", () => {
    const toCampus = toMatchInputs(batchOf([], [offerDoc({ id: 'o' })]), new Map(), t).offers[0];
    expect(toCampus.travelWindow.start).toEqual(melb(5, '08:00'));
    expect(toCampus.travelWindow.end.getTime()).toBeCloseTo(
      melb(5, '08:00').getTime() + (t.minutes(north(20), CAMPUS) + 20) * 60_000, -1,
    );

    // Leaving campus, everyone boards at departure.
    const fromCampus = toMatchInputs(batchOf([], [offerDoc({ id: 'o', toUni: false })]), new Map(), t).offers[0];
    expect(fromCampus.travelWindow).toEqual({ start: melb(5, '08:00'), end: melb(5, '08:00') });
  });

  it('rebuilds confirmed riders in stored pickup order, with their current detours', () => {
    const far = reqDoc({ id: 'far', status: 'confirmed', coord: north(15) });
    const near = reqDoc({ id: 'near', status: 'confirmed', coord: north(6) });
    const confirmed = new Map([[far.id, far], [near.id, near]]);
    const doc = offerDoc({ id: 'o', confirmedRequestIds: ['far', 'near'] });

    const offer = toMatchInputs(batchOf([], [doc]), confirmed, t).offers[0];
    const ev = evaluateRoute(north(20), [north(15), north(6)], CAMPUS, melb(5, '08:00'), t);

    expect(offer.onBoard.map((r) => r.reqId)).toEqual(['far', 'near']);
    expect(offer.onBoard.map((r) => r.currentDetour)).toEqual(ev.riderDetours);
    expect(offer.currTripDuration).toBeCloseTo(ev.totalMinutes);
    expect(offer.onBoard.map((r) => r.earliest)).toEqual([melb(5, '08:00'), melb(5, '08:00')]);
    expect(offer).toMatchObject({ seatsOffered: 3, seatsFilled: 2, status: 'open', acceptingMore: true });
  });

  it('closes an offer whose confirmed riders fill every seat', () => {
    const r = reqDoc({ id: 'r', status: 'confirmed' });
    const doc = offerDoc({ id: 'o', seatCapacity: 1, confirmedRequestIds: ['r'] });
    expect(toMatchInputs(batchOf([], [doc]), new Map([[r.id, r]]), t).offers[0].status).toBe('closed');
  });

  it('leaves out an offer whose confirmed rider cannot be read back', () => {
    const doc = offerDoc({ id: 'o', confirmedRequestIds: ['vanished'] });
    const res = toMatchInputs(batchOf([], [doc]), new Map(), t);
    expect(res.offers).toEqual([]);
    expect(res.skipped).toEqual([{ kind: 'offer', id: 'o', reason: 'CONFIRMED_RIDER_UNKNOWN' }]);
  });
});

describe('batchPoints', () => {
  it('covers campus, every booking and every confirmed rider', () => {
    const rider = reqDoc({ id: 'c', status: 'confirmed', coord: north(12) });
    const batch = groupIntoBatches(
      [reqDoc({ id: 'r' })], [offerDoc({ id: 'o', confirmedRequestIds: ['c'] })], NOW,
    ).batches[0];
    expect(batchPoints(batch, new Map([[rider.id, rider]]))).toEqual([CAMPUS, north(8), north(20), north(12)]);
  });
});
