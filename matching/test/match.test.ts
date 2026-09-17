import { runMatching } from '../src/match';
import { SyntheticTravelTime } from '../src/travelTime';
import { DEFAULT_CONFIG } from '../src/types';
import { CAMPUS, at, makeOffer, makeRequest } from './fixtures';

const t = new SyntheticTravelTime({ jitter: 0, seed: 1 });
const near = { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon };

describe('acceptDeadline', () => {
  it('uses the normal approval window when matching happens well ahead of the cutoff', () => {
    // Matched more than (approvalWindow + cutoff) before departure, so the
    // approval window itself is the binding constraint, not the cutoff.
    const departAt = at(8, 0, 16);
    const matchedAt = at(0, 0, 15); // 32 hours before departure

    const res = runMatching(
      'batch', [makeRequest({ reqId: 'r', start: near, travelWindow: { start: at(7, 0, 16), end: at(8, 30, 16) }, arriveBy: at(9, 0, 16) })],
      [makeOffer({ offerId: 'o', start: near, travelWindow: { start: at(7, 0, 16), end: at(8, 30, 16) } })],
      departAt, matchedAt, t,
    );

    expect(res.matches).toHaveLength(1);
    const expected = new Date(matchedAt.getTime() + DEFAULT_CONFIG.approvalWindowMinutes * 60_000);
    expect(res.matches[0].acceptDeadline.getTime()).toBe(expected.getTime());
    expect(res.matches[0].acceptDeadline.getTime()).toBeLessThan(departAt.getTime());
  });

  it('clamps to the matching cutoff when the full approval window would run past it', () => {
    // Matched only 3 hours before departure: the full 12-hour approval window
    // would promise a deadline long after the trip has already left.
    const departAt = at(8);
    const matchedAt = at(5);

    const res = runMatching(
      'batch', [makeRequest({ reqId: 'r', start: near })],
      [makeOffer({ offerId: 'o', start: near })],
      departAt, matchedAt, t,
    );

    expect(res.matches).toHaveLength(1);
    const expectedCutoff = new Date(departAt.getTime() - DEFAULT_CONFIG.matchingCutoffMinutes * 60_000);
    expect(res.matches[0].acceptDeadline.getTime()).toBe(expectedCutoff.getTime());
    // Never promise more time than the batch can actually honour.
    expect(res.matches[0].acceptDeadline.getTime()).toBeLessThanOrEqual(departAt.getTime());
  });
});

describe('matching cutoff at the batch level', () => {
  it('locks every open trip once departure is within the cutoff, however many seats are free', () => {
    const departAt = at(8);
    const now = at(7); // 60 minutes out, inside the 120-minute default cutoff

    const res = runMatching(
      'batch', [makeRequest({ reqId: 'r', start: near })],
      [makeOffer({ offerId: 'o', start: near, seatsOffered: 4, seatsFilled: 0 })],
      departAt, now, t,
    );

    expect(res.matches).toHaveLength(0);
    expect(res.unmatchedRequestIds).toEqual(['r']);
    expect(res.stats.closedByCutoff).toBe(1);
    expect(res.rejected.some((rj) => rj.reason === 'MATCHING_CUTOFF')).toBe(true);
  });
});
