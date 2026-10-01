/*
Tests runner/runOnce.ts - a whole matching run, start to finish, against an
in-memory stand-in for Firestore. The store applies the same planMatchWrite /
planSettle decisions the real runner/firestore.ts applies inside its
transactions, and mimics what the app writes, so what is exercised here is
everything except the SDK.

  several runs in a row   match, wait for an answer, accept, then fill the
                          next seat in pickup order
  driver removes offer    its riders, pending and confirmed, go back to the
                          pool and can be matched to another driver
  expiry                  an unanswered match expires and the freed driver is
                          offered someone else in the same run
  dry run                 matches are computed but nothing is written
  a failing batch         one batch failing (e.g. Google refusing) is reported
                          and doesn't stop the others

Travel times: synthetic at exactly 1 minute per km.
*/

import { MatchingStore, runOnce } from '../runner/runOnce';
import { MONASH_CLAYTON as CAMPUS, OfferDoc, RequestDoc } from '../src/adapter';
import { zonedDateTime } from '../src/melbourneTime';
import { SyntheticTravelTime } from '../src/travelTime';
import { Coord } from '../src/types';
import { FieldUpdate, planMatchWrite, planSettle, Settled } from '../src/writes';

type Doc = Record<string, any>;

class MemoryStore implements MatchingStore {
  requests = new Map<string, Doc>();
  offers = new Map<string, Doc>();
  pointsPerBatch: Coord[][] = [];

  private apply(doc: Doc, u: FieldUpdate) {
    Object.assign(doc, u.set);
    for (const f of u.remove) delete doc[f];
  }

  async settleMatched(now: Date) {
    const settled: Settled = { released: [], expired: [] };
    for (const [id, req] of this.requests) {
      const offer = req.matchedOfferId ? this.offers.get(req.matchedOfferId) : undefined;
      const plan = planSettle(id, req as any, offer as any, now);
      if (!plan) continue;
      this.apply(req, plan.request);
      if (plan.offer && offer) this.apply(offer, plan.offer);
      (plan.outcome === 'RELEASED' ? settled.released : settled.expired).push(id);
    }
    return settled;
  }

  async loadPending() {
    const pending = (m: Map<string, Doc>) => [...m.values()].filter((d) => d.status === 'pending').map((d) => ({ ...d }));
    return { requests: pending(this.requests) as RequestDoc[], offers: pending(this.offers) as OfferDoc[] };
  }

  async loadRequestsById(ids: string[]) {
    return new Map(ids.filter((id) => this.requests.has(id)).map((id) => [id, { ...this.requests.get(id)! } as RequestDoc]));
  }

  async writeMatches(writes: Parameters<MatchingStore['writeMatches']>[0]) {
    const applied: string[] = [];
    const skipped: Array<{ reqId: string; reason: any }> = [];
    for (const m of writes) {
      const req = this.requests.get(m.reqId);
      const offer = this.offers.get(m.offerId);
      const plan = planMatchWrite(req as any, offer as any, m);
      if (!plan.ok) { skipped.push({ reqId: m.reqId, reason: plan.reason }); continue; }
      this.apply(req!, plan.request);
      this.apply(offer!, plan.offer);
      applied.push(m.reqId);
    }
    return { applied, skipped };
  }

  /** What the app's acceptMatch (firebaseBookingMethods.ts) does to the documents. */
  accept(reqId: string) {
    const req = this.requests.get(reqId)!;
    const offer = this.offers.get(req.matchedOfferId)!;
    const confirmed: string[] = offer.confirmedRequestIds ?? [];
    const at = Math.min(Math.max(req.routeIndex ?? confirmed.length, 0), confirmed.length);
    const ordered = [...confirmed.slice(0, at), reqId, ...confirmed.slice(at)];
    req.status = 'confirmed';
    Object.assign(offer, {
      confirmedRequestIds: ordered,
      pendingRequestId: null,
      schedule: offer.pendingSchedule,
      status: ordered.length >= offer.seatCapacity ? 'confirmed' : 'pending',
    });
    delete offer.matchedRiderId;
    delete offer.pendingSchedule;
  }

  /** What the app's cancelOffer does: the driver removes the whole trip. */
  cancelOffer(offerId: string) {
    this.offers.get(offerId)!.status = 'cancelled';
  }
}

const t = new SyntheticTravelTime({ roadFactor: 1, avgSpeedKmh: 60, jitter: 0 });
const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });
const NOW = new Date('2026-10-01T00:00:00Z');
const tripDay = zonedDateTime({ year: 2026, month: 10, day: 5 }, '00:00');

function seed(store: MemoryStore) {
  const rider = (id: string, coord?: Coord) => ({
    id, userId: 'u-' + id, status: 'pending', toUni: true, coord,
    date: tripDay, departureTime: '07:30', arrivalTime: '09:00',
  });
  store.requests.set('r1', rider('r1', north(8)));
  store.requests.set('r2', rider('r2', north(14)));
  store.requests.set('lost', rider('lost')); // address never resolved
  store.offers.set('d', {
    id: 'd', userId: 'u-d', status: 'pending', toUni: true, coord: north(20),
    date: tripDay, departureTime: '08:00', arrivalTime: '09:00',
    maxDetourTime: 20, seatCapacity: 3, pendingRequestId: null, confirmedRequestIds: [],
  });
}

const options = (store: MemoryStore, now = NOW, dryRun = false) => ({
  now,
  dryRun,
  travelTimes: async (points: Coord[]) => { store.pointsPerBatch.push(points); return t; },
});

describe('runOnce', () => {
  it('matches, waits for the rider, then fills the next seat in pickup order', async () => {
    const store = new MemoryStore();
    seed(store);

    // Run 1: the driver is offered exactly one new rider.
    const first = await runOnce(store, options(store));
    expect(first.skipped).toEqual([{ kind: 'request', id: 'lost', reason: 'NO_COORD' }]);
    expect(first.batches).toHaveLength(1);
    expect(first.batches[0]).toMatchObject({ batchKey: '2026-10-05_TO_CAMPUS', requests: 2, offers: 1, applied: ['r1'] });
    expect(store.requests.get('r1')).toMatchObject({ status: 'awaiting', matchedOfferId: 'd', routeIndex: 0 });
    expect(store.offers.get('d')).toMatchObject({ status: 'awaiting', pendingRequestId: 'r1', matchedRiderId: 'u-r1' });
    // The timetable the card shows: r1's pickup and arrival, planned to reach
    // campus by 8:50 for their stated 9:00 (arrivalMarginMinutes).
    const r1 = store.requests.get('r1')!;
    expect(store.offers.get('d')!.pendingSchedule.stops).toEqual([
      { requestId: 'r1', pickupAt: r1.pickupAt, arriveAt: r1.arriveAt },
    ]);
    expect(r1.pickupAt.getTime()).toBeGreaterThan(zonedDateTime({ year: 2026, month: 10, day: 5 }, '08:00').getTime());
    expect(r1.arriveAt.getTime()).toBeLessThanOrEqual(zonedDateTime({ year: 2026, month: 10, day: 5 }, '08:50').getTime());
    expect(store.offers.get('d')!.schedule).toBeUndefined(); // nobody confirmed yet
    expect(store.requests.get('r2')!.status).toBe('pending');
    expect(store.pointsPerBatch).toHaveLength(1); // one travel-time matrix per batch

    // Run 2, before anyone answers: the driver is waiting on r1, so nobody else is offered.
    const second = await runOnce(store, options(store));
    expect(second.batches[0]).toMatchObject({ offers: 0, matches: [] });

    // r1 accepts. The car has two seats left and goes back into the pool.
    store.accept('r1');
    expect(store.offers.get('d')).toMatchObject({ status: 'pending', confirmedRequestIds: ['r1'] });
    // Accepting moves the proposed timetable into place.
    expect(store.offers.get('d')!.schedule.stops.map((s: any) => s.requestId)).toEqual(['r1']);
    expect(store.offers.get('d')!.pendingSchedule).toBeUndefined();

    // Run 3: r2 lives further out, on the driver's way in, so it is picked up FIRST.
    const third = await runOnce(store, options(store));
    expect(third.batches[0].applied).toEqual(['r2']);
    expect(store.requests.get('r2')).toMatchObject({ status: 'awaiting', routeIndex: 0 });
    // The proposal re-times the whole car, r1 included; r1's confirmed times
    // stay as they were until r2 accepts.
    expect(store.offers.get('d')!.pendingSchedule.stops.map((s: any) => s.requestId)).toEqual(['r2', 'r1']);
    expect(store.offers.get('d')!.schedule.stops.map((s: any) => s.requestId)).toEqual(['r1']);

    store.accept('r2');
    expect(store.offers.get('d')!.confirmedRequestIds).toEqual(['r2', 'r1']);
    expect(store.offers.get('d')!.schedule.stops.map((s: any) => s.requestId)).toEqual(['r2', 'r1']);
  });

  it('returns every rider to the pool when the driver removes the offer', async () => {
    const store = new MemoryStore();
    seed(store);
    store.offers.set('d2', { ...store.offers.get('d'), id: 'd2', userId: 'u-d2' });
    await runOnce(store, options(store)); // r1 -> d, r2 -> d2
    store.accept('r1');
    expect(store.requests.get('r2')).toMatchObject({ status: 'awaiting', matchedOfferId: 'd2' });

    // d removes the trip after r1 confirmed; d2 removes theirs while r2 is still deciding.
    store.cancelOffer('d');
    store.cancelOffer('d2');
    const report = await runOnce(store, options(store));

    expect(report.settled.released.sort()).toEqual(['r1', 'r2']);
    for (const id of ['r1', 'r2']) {
      expect(store.requests.get(id)!.status).toBe('pending');
      expect(store.requests.get(id)).not.toHaveProperty('matchedOfferId');
    }
    // Both offers are gone, so there's nobody left to match them with this time.
    expect(report.batches[0]).toMatchObject({ offers: 0, applied: [] });
  });

  it('expires an unanswered match and offers the freed driver someone else in the same run', async () => {
    const store = new MemoryStore();
    seed(store);
    await runOnce(store, options(store)); // r1 matched, deadline 12h later

    const later = new Date(NOW.getTime() + 13 * 3_600_000);
    const report = await runOnce(store, options(store, later));

    expect(report.settled.expired).toEqual(['r1']);
    expect(store.requests.get('r1')!.status).toBe('expired');
    expect(report.batches[0].applied).toEqual(['r2']);
    expect(store.offers.get('d')).toMatchObject({ status: 'awaiting', pendingRequestId: 'r2' });
  });

  it('writes nothing on a dry run', async () => {
    const store = new MemoryStore();
    seed(store);
    const before = JSON.stringify([...store.requests, ...store.offers]);

    const report = await runOnce(store, options(store, NOW, true));

    expect(report.batches[0].matches.map((m) => m.reqId)).toEqual(['r1']);
    expect(report.batches[0].applied).toEqual([]);
    expect(JSON.stringify([...store.requests, ...store.offers])).toBe(before);
  });

  it('keeps going when one batch fails, and reports which', async () => {
    const store = new MemoryStore();
    seed(store);
    const report = await runOnce(store, {
      now: NOW,
      dryRun: false,
      travelTimes: async () => { throw new Error('Route Matrix request failed: 403 Forbidden'); },
    });
    expect(report.batches[0].error).toMatch(/403/);
    expect(store.requests.get('r1')!.status).toBe('pending');
  });
});

describe('runOnce — explanations', () => {
  it('reports who was left out and why', async () => {
    const store = new MemoryStore();
    seed(store);
    const report = await runOnce(store, options(store, NOW, true));
    // r1 and r2 cost the driver the same, so r1 - who asked first - keeps the seat.
    expect(report.batches[0].unmatched).toEqual([
      { reqId: 'r2', byOffer: [{ offerId: 'd', reason: 'LOST_SLOT' }] },
    ]);
  });
});
