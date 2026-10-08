import type { MatchOffer, MatchRequest, Trip, Waypoint, Coord } from '../../backend/server/matching.schema';
import { tOfDay, mkCoord, mkTrip, mkReq, mkOffer, UNI, deepFreeze } from '../helpers';

// load modules
type Scoring = {
  calcDrivingTimeScore(d: MatchOffer, t: Trip): number;
  calcSlackScore(d: MatchOffer, t: Trip): number;
  calcOnTimeScore(p: MatchRequest, t: Trip): number;
  calcDriverScore(d: MatchOffer, t: Trip | null): number;
  calcPassengerScore(d: MatchOffer, p: MatchRequest, t: Trip | null): number;
  coordIsUni(c: Coord): boolean;
};
type Weights = { driving: number; drSlack: number; punctuality: number; pSlack: number; };

/** Loads the scoring module with the uni mocked to UNI, and optionally with replacement weights. */
function loadScoring(w?: Weights): Scoring {
  let mod!: Scoring;
  jest.isolateModules(() => {
    jest.doMock('../../mobile/services/googlePlaces', () => {
      const actual = jest.requireActual('../../mobile/services/googlePlaces');
      return {
        ...actual,
        MONASH_CLAYTON_LOCATION: { ...actual.MONASH_CLAYTON_LOCATION, lat: UNI.lat, lng: UNI.lon },
      };
    });
    if (w) {
      jest.doMock('../../backend/server/scoringConst', () => ({
        __esModule: true,
        DRIVING_TIME_FACTOR: w.driving,
        DR_SLACK_TIME_FACTOR: w.drSlack,
        PUNCTUALITY_FACTOR: w.punctuality,
        P_SLACK_TIME_FACTOR: w.pSlack,
      }));
    } else {
      jest.dontMock('../../backend/server/scoringConst'); // don't inherit weights from an earlier call
    }
    mod = {
      ...require('../../backend/server/scoring'),
      coordIsUni: require('../../backend/server/matching').coordIsUni,
    };
  });
  return mod;
}

const DECOY = 45; // minutes of slack on every waypoint the score should NOT read
const DIRS: [string, boolean][] = [['to-uni', true], ['from-uni', false]];

const uniWp = (slackMin: number): Waypoint => ({ loc: UNI, earliest: tOfDay(8), latest: tOfDay(8, slackMin) });
const stopWp = (lat: number, slackMin = DECOY): Waypoint =>
  ({ loc: mkCoord(lat), earliest: tOfDay(8), latest: tOfDay(8, slackMin) });
const withDur = (t: Trip, currDur: number): Trip => ({ ...t, currDur });

/** Trip of n waypoints with the uni last (to-uni) or first (from-uni) and decoy stops elsewhere. */
const slackTrip = (toUni: boolean, n: number, uniSlack: number): Trip => {
  const stops = Array.from({ length: n - 1 }, (_, i) => stopWp(UNI.lat - 300 + 10 * i));
  return mkTrip(toUni ? [...stops, uniWp(uniSlack)] : [uniWp(uniSlack), ...stops]);
};

/** Trip where only currDur matters (detour score). */
const durTrip = (dur: number): Trip => mkTrip([stopWp(UNI.lat - 300), uniWp(0)], [dur], [1000]);

/**
 * Passenger fixture, legs [10, 12, 8].
 *   to-uni:   [driver, other, PASSENGER pickup, uni]       passenger transit = 8 min (leg 2)
 *   from-uni: [uni, other, PASSENGER drop-off, driver end] passenger transit = 22 min (legs 0 + 1)
 * maxBuffer = window length - transit; currBuffer = passenger waypoint's latest - earliest.
 */
const onTimeCase = (toUni: boolean, maxBuffer: number, currBuffer: number, uniSlack = DECOY) => {
  const transit = toUni ? 8 : 22;
  const passenger: Waypoint = { loc: mkCoord(toUni ? UNI.lat - 75 : UNI.lat - 225), earliest: tOfDay(8), latest: tOfDay(8, currBuffer) };
  const wps = toUni
    ? [stopWp(UNI.lat - 300), stopWp(UNI.lat - 150), passenger, uniWp(uniSlack)]
    : [uniWp(uniSlack), stopWp(UNI.lat - 150), passenger, stopWp(UNI.lat - 300)];
  const newTrip = mkTrip(wps, [10, 12, 8], [1000, 1000, 1000]);
  const window = { start: tOfDay(8), end: tOfDay(8, transit + maxBuffer) };
  const p = toUni ? mkReq(passenger.loc, UNI, window) : mkReq(UNI, passenger.loc, window);
  return { p, newTrip };
};

// Real weights are not under test, so the component tests use the real module as-is.
const S = loadScoring();

// Harness wiring: the mocked uni location is what coordIsUni sees
describe('test harness: mocked uni location', () => {
  it('recognises UNI (exact equality)', () => {
    expect(S.coordIsUni(UNI)).toBe(true);
  });
  it.each([
    ['lat 1 higher', { lat: UNI.lat + 1, lon: UNI.lon }],
    ['lon 1 lower', { lat: UNI.lat, lon: UNI.lon - 1 }],
    ['elsewhere', mkCoord(5)],
  ])('does not recognise a point with %s', (_n, c) => {
    expect(S.coordIsUni(c)).toBe(false);
  });
});

// calcDrivingTimeScore: max trip time = 30 + 20 = 50 min
//   currRem = 50 - currDur, newRem = 50 - newDur
describe('calcDrivingTimeScore', () => {
  const run = (currDur: number, newDur: number, o: Partial<MatchOffer> = {}) =>
    S.calcDrivingTimeScore(mkOffer(durTrip(currDur), true, o), durTrip(newDur));

  describe('valid scores (currDur 40 => currRem 10)', () => {
    it.each([
      ['newRem 9 (just below currRem)', 41, 0.9],
      ['newRem 10 (on currRem): nothing consumed', 40, 1],
      ['newRem 1 (just above 0)', 49, 0.1],
      ['newRem 0 (on lower boundary)', 50, 0],
      ['newRem -1 (just below 0): passenger exceeds the max detour', 51, 0],
    ])('%s', (_n, newDur, expected) => {
      expect(run(40, newDur)).toBeCloseTo(expected, 10);
    });
  });

  describe('currRem boundary (-1 / 0 / 1)', () => {
    it('currRem 1 (just above 0): valid', () => {
      expect(run(49, 49)).toBeCloseTo(1, 10);
      expect(run(49, 50)).toBeCloseTo(0, 10);
    });
    it('currRem 0 (on boundary): zero denominator scores 0', () => {
      expect(run(50, 50)).toBe(0);
    });
    it('currRem 0 and the trip got shorter: newRem > currRem errors', () => {
      expect(() => run(50, 49)).toThrow();
    });
    it('currRem 0 and passenger exceeds the max: scores 0', () => {
      expect(run(50, 51)).toBe(0);
    });
    it('currRem -1 (just below 0): current trip already exceeds the max, errors', () => {
      expect(() => run(51, 51)).toThrow();
    });
  });

  it('newRem 11 (new trip shorter than current, just above currRem 10): errors', () => {
    expect(() => run(40, 39)).toThrow(); // FAILS now (returns 1.1)
  });
  it('currRem 1 and newRem 2 (above currRem): errors', () => {
    expect(() => run(49, 48)).toThrow(); // FAILS now
  });

  it('uses both directTime and maxDetour (25 + 15 = 40; currRem 10, newRem 5)', () => {
    const o = { directTime: 25, window: { start: tOfDay(7), end: tOfDay(12), maxDetour: 15 } };
    expect(run(30, 35, o)).toBeCloseTo(0.5, 10);
  });
});

// calcSlackScore: uni waypoint is last (to-uni) or first (from-uni)
describe.each(DIRS)('calcSlackScore (%s)', (_dir, toUni) => {
  const run = (currSlack: number, newSlack: number, currN = 3) =>
    S.calcSlackScore(mkOffer(slackTrip(toUni, currN, currSlack), toUni), slackTrip(toUni, currN + 1, newSlack));

  it.each([
    ['newSlack 19 (just below currSlack 20)', 20, 19, 0.95],
    ['newSlack 20 (on currSlack)', 20, 20, 1],
    ['newSlack 1 (just above 0)', 20, 1, 0.05],
    ['newSlack 0 (on lower boundary)', 20, 0, 0],
    ['currSlack 1, newSlack 1', 1, 1, 1],
    ['currSlack 1, newSlack 0', 1, 0, 0],
    ['currSlack 0 (zero denominator), newSlack 0', 0, 0, 0], // FAILS now (NaN)
  ])('%s', (_n, curr, nw, expected) => {
    expect(run(curr, nw)).toBeCloseTo(expected, 10);
  });

  it.each([
    ['newSlack 21 (just above currSlack): errors', 20, 21],
    ['currSlack 1, newSlack 2: errors', 1, 2],
    ['currSlack 0, newSlack 1: errors', 0, 1],
    ['newSlack -1 (latest before earliest): errors', 20, -1],
    ['currSlack -1 (latest before earliest): errors', -1, -1],
  ])('%s', (_n, curr, nw) => {
    expect(() => run(curr, nw)).toThrow(); // FAILS now (no validation)
  });

  it.each([2, 3, 6])('reads the uni waypoint with a current trip of %i waypoints', (n) => {
    expect(run(20, 10, n)).toBeCloseTo(0.5, 10);
  });

  it('throws when the offer is not to or from uni', () => {
    const d = mkOffer(slackTrip(toUni, 3, 20), toUni, { start: mkCoord(5), end: mkCoord(6) });
    expect(() => S.calcSlackScore(d, slackTrip(toUni, 4, 10))).toThrow(/not to or from uni/);
  });
});

// calcOnTimeScore: score = currBuffer / maxBuffer
describe.each(DIRS)('calcOnTimeScore (%s)', (_dir, toUni) => {
  const run = (maxBuffer: number, currBuffer: number) => {
    const { p, newTrip } = onTimeCase(toUni, maxBuffer, currBuffer);
    return S.calcOnTimeScore(p, newTrip);
  };

  it.each([
    ['maxBuffer 40, currBuffer 39 (just below max)', 40, 39, 0.975],
    ['maxBuffer 40, currBuffer 40 (on max)', 40, 40, 1],
    ['maxBuffer 40, currBuffer 0', 40, 0, 0],
    ['maxBuffer 1 (just above 0), currBuffer 1', 1, 1, 1],
    ['maxBuffer 1 (just above 0), currBuffer 0', 1, 0, 0],
    ['maxBuffer 0 (on boundary), currBuffer 0', 0, 0, 0], // FAILS now (NaN)
    ['maxBuffer -1 (just below 0), currBuffer 0', -1, 0, 0],
    ['maxBuffer -1, currBuffer 5: the maxBuffer check runs first', -1, 5, 0], // FAILS now (-5)
  ])('%s', (_n, maxBuf, currBuf, expected) => {
    expect(run(maxBuf, currBuf)).toBeCloseTo(expected, 10);
  });

  it.each([
    ['currBuffer 41 (just above maxBuffer 40)', 40, 41],
    ['currBuffer 2 (maxBuffer 1)', 1, 2],
    ['currBuffer 1 (maxBuffer 0)', 0, 1],
  ])('%s: errors', (_n, maxBuf, currBuf) => {
    expect(() => run(maxBuf, currBuf)).toThrow(); // FAILS now
  });

  describe('passenger endpoint not in the trip', () => {
    it('start missing', () => {
      const { p, newTrip } = onTimeCase(toUni, 40, 20);
      expect(() => S.calcOnTimeScore({ ...p, start: mkCoord(5) }, newTrip)).toThrow(/could not be found/);
    });
    it('end missing', () => {
      const { p, newTrip } = onTimeCase(toUni, 40, 20);
      expect(() => S.calcOnTimeScore({ ...p, end: mkCoord(5) }, newTrip)).toThrow(/could not be found/);
    });
  });
});

// Waypoints at identical coordinates (windows differ, so the passenger's own must be used)
//   Expected: maxBuffer 30, passenger currBuffer 15 => 0.5. Decoys have 45 min of slack.
//   Transit is the same whichever duplicate is found, because identical waypoints are 0 min apart.
describe('calcOnTimeScore with duplicate coordinates (S4)', () => {
  const pax = (lat: number) => stopWp(lat, 15);
  const dec = (lat: number) => stopWp(lat, DECOY);
  const L = (n: number) => UNI.lat - n;

  const cases: [string, boolean, Waypoint[], number[], number, number][] = [
    // name, toUni, waypoints, legs, passenger transit, passenger lat
    ['to-uni: pickup equals the driver\'s start (FAILS now: reads the driver\'s window)', true,
      [dec(L(300)), pax(L(300)), dec(L(150)), uniWp(DECOY)], [0, 12, 8], 20, L(300)],
    ['to-uni: pickup shared with an earlier passenger, new stop AFTER it (FAILS now)', true,
      [dec(L(300)), dec(L(75)), pax(L(75)), uniWp(DECOY)], [10, 0, 8], 8, L(75)],
    ['to-uni: pickup shared with an earlier passenger, new stop BEFORE it', true,
      [dec(L(300)), pax(L(75)), dec(L(75)), uniWp(DECOY)], [10, 0, 8], 8, L(75)],
    ['from-uni: drop-off equals the driver\'s final stop', false,
      [uniWp(DECOY), dec(L(150)), pax(L(300)), dec(L(300))], [10, 12, 0], 22, L(300)],
    ['from-uni: drop-off shared with an earlier passenger, new stop AFTER it (FAILS now)', false,
      [uniWp(DECOY), dec(L(225)), pax(L(225)), dec(L(300))], [10, 0, 12], 10, L(225)],
    ['from-uni: drop-off shared with an earlier passenger, new stop BEFORE it', false,
      [uniWp(DECOY), pax(L(225)), dec(L(225)), dec(L(300))], [10, 0, 12], 10, L(225)],
  ];

  it.each(cases)('%s', (_n, toUni, wps, legs, transit, lat) => {
    const newTrip = mkTrip(wps, legs, legs.map(() => 1000));
    const window = { start: tOfDay(8), end: tOfDay(8, transit + 30) };
    const p = toUni ? mkReq(mkCoord(lat), UNI, window) : mkReq(UNI, mkCoord(lat), window);
    expect(S.calcOnTimeScore(p, newTrip)).toBeCloseTo(0.5, 10);
  });
});

// Weighted scores. Components: driver time 0.5 + slack 0.25, passenger on-time 0.8 + slack 0.25.
// Weight sets all sum to 1 (a = time/punctuality weight, b = slack weight).
const WEIGHT_SETS: [number, number][] = [[0.5, 0.5], [1, 0], [0, 1], [0.7, 0.3]];
const weightsOf = (a: number, b: number): Weights => ({ driving: a, drSlack: b, punctuality: a, pSlack: b });

describe.each(DIRS)('weighted scores (%s)', (_dir, toUni) => {
  const driver = (timeCurr: number, timeNew: number, slackCurr: number, slackNew: number) => ({
    d: mkOffer(withDur(slackTrip(toUni, 3, slackCurr), timeCurr), toUni),
    t: withDur(slackTrip(toUni, 4, slackNew), timeNew),
  });
  const passenger = (maxBuffer: number, currBuffer: number, slackCurr: number, slackNew: number) => {
    const { p, newTrip } = onTimeCase(toUni, maxBuffer, currBuffer, slackNew);
    return { d: mkOffer(slackTrip(toUni, 3, slackCurr), toUni), p, t: newTrip };
  };

  describe.each(WEIGHT_SETS)('weights a=%d, b=%d', (a, b) => {
    const W = loadScoring(weightsOf(a, b));

    it('driver score = a * timeScore + b * slackScore', () => {
      const { d, t } = driver(40, 45, 20, 5); // 0.5, 0.25
      expect(W.calcDriverScore(d, t)).toBeCloseTo(a * 0.5 + b * 0.25, 10);
    });
    it('passenger score = a * onTimeScore + b * slackScore', () => {
      const { d, p, t } = passenger(40, 32, 20, 5); // 0.8, 0.25
      expect(W.calcPassengerScore(d, p, t)).toBeCloseTo(a * 0.8 + b * 0.25, 10);
    });
    it('driver: perfect components give exactly 1, worst give 0', () => {
      const best = driver(40, 40, 20, 20);
      const worst = driver(40, 50, 20, 0);
      expect(W.calcDriverScore(best.d, best.t)).toBeCloseTo(1, 10);
      expect(W.calcDriverScore(worst.d, worst.t)).toBeCloseTo(0, 10);
    });
    it('passenger: perfect components give exactly 1, worst give 0', () => {
      const best = passenger(40, 40, 20, 20);
      const worst = passenger(40, 0, 20, 0);
      expect(W.calcPassengerScore(best.d, best.p, best.t)).toBeCloseTo(1, 10);
      expect(W.calcPassengerScore(worst.d, worst.p, worst.t)).toBeCloseTo(0, 10);
    });
  });

  describe('null trip and validation', () => {
    const nonUniOffer = () => mkOffer(slackTrip(toUni, 3, 20), toUni, { start: mkCoord(5), end: mkCoord(6) });
    const { p, newTrip } = onTimeCase(toUni, 40, 20, 5);
    const okOffer = () => mkOffer(slackTrip(toUni, 3, 20), toUni);

    it('calcDriverScore: null trip returns 0', () => {
      expect(S.calcDriverScore(okOffer(), null)).toBe(0);
    });
    it('calcPassengerScore: null trip returns 0', () => {
      expect(S.calcPassengerScore(okOffer(), p, null)).toBe(0);
    });
    it('null trip returns 0 even for a non-uni offer (null is checked first)', () => {
      expect(S.calcDriverScore(nonUniOffer(), null)).toBe(0);
      expect(S.calcPassengerScore(nonUniOffer(), p, null)).toBe(0);
    });
    it('calcDriverScore throws for a non-uni offer', () => {
      expect(() => S.calcDriverScore(nonUniOffer(), withDur(newTrip, 45))).toThrow(/not to or from uni/);
    });
    it('calcPassengerScore throws for a non-uni offer', () => {
      expect(() => S.calcPassengerScore(nonUniOffer(), p, newTrip)).toThrow(/not to or from uni/);
    });
  });
});

// Immutability
describe('immutability', () => {
  it('no scoring function mutates its inputs', () => {
    const { p, newTrip } = onTimeCase(true, 40, 32, 5);
    const nt = withDur(newTrip, 45);
    const d = mkOffer(withDur(slackTrip(true, 3, 20), 40), true);
    const before = JSON.stringify([d, p, nt]); // Dates serialise to ISO strings, so time changes are caught
    [d, p, nt].forEach(deepFreeze);

    expect(() => {
      S.calcDrivingTimeScore(d, nt);
      S.calcSlackScore(d, nt);
      S.calcOnTimeScore(p, nt);
      S.calcDriverScore(d, nt);
      S.calcPassengerScore(d, p, nt);
    }).not.toThrow();
    expect(JSON.stringify([d, p, nt])).toBe(before);
  });
});