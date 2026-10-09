/*
Tests src/score.ts - how good a rider/driver pairing is from each side, after
David's calcDriverScore / calcPassengerScore. Scores run 0 to 1, higher is better.

  sub-scores     each ingredient on its own: share of the driver's detour left,
                 slack left (minutes to spare before the tightest deadline in
                 the car, each person measured where they get out), and that
                 each side's weights add up to 1
  scorePairing   the full score for a real pairing: two riders who cost the
                 driver the same minutes are told apart by slack

Travel times: synthetic, straight lines, 2.1 min per km, no noise.
*/

import {
  arrivalSlackMinutes, calcDrivingTimeScore, calcSlackScore, DEFAULT_WEIGHTS, scorePairing,
} from '../../matching/src/score';
import { SyntheticTravelTime } from '../../matching/src/travelTime';
import { CAMPUS, at, makeOffer, makeRequest } from '../fixtures';

const t = new SyntheticTravelTime({ jitter: 0 }); // 2.1 min per km
const north = (km: number) => ({ lat: CAMPUS.lat + km / 110.57, lon: CAMPUS.lon });

describe('sub-scores', () => {
  it("driving time is David's remaining-detour ratio (newRem / currRem)", () => {
    // 20 minutes of detour left, this rider uses 5: 15 of 20 remain.
    expect(calcDrivingTimeScore(5, 20)).toBeCloseTo(15 / 20);
  });

  it('slack is the share of the car\'s slack left, kept in [0, 1]', () => {
    expect(calcSlackScore(30, 25)).toBeCloseTo(25 / 30);
    expect(calcSlackScore(30, -5)).toBe(0);
    expect(calcSlackScore(10, 20)).toBe(1);
  });

  it('measures slack to the tightest deadline in the car', () => {
    const arrival = at(8, 40);
    expect(arrivalSlackMinutes([at(9), at(8, 50), at(9, 30)].map((deadline) => ({ deadline, arrival }))))
      .toBeCloseTo(10);
  });

  it('measures each person against their own arrival', () => {
    // Dropped off at 17:10 with a 17:15 deadline: 5 minutes, even though the
    // driver - due home by 18:00 - only gets there at 17:42.
    expect(arrivalSlackMinutes([
      { deadline: at(18), arrival: at(17, 42) },
      { deadline: at(17, 15), arrival: at(17, 10) },
    ])).toBeCloseTo(5);
  });

  it("weights each side's sub-scores to a total of 1", () => {
    const w = DEFAULT_WEIGHTS;
    expect(w.drivingTimeFactor + w.driverSlackFactor).toBeCloseTo(1);
    expect(w.detourFactor + w.punctualityFactor + w.passengerSlackFactor).toBeCloseTo(1);
  });
});

describe('scorePairing — slack', () => {
  // Same pickup spot, so both riders cost the driver exactly the same minutes.
  // The car reaches campus at 8:42; one rider must be there by 8:43.
  const offer = makeOffer({ offerId: 'o', start: north(20), maxDetour: 20 });
  const relaxed = makeRequest({ reqId: 'relaxed', start: north(10), arriveBy: at(9, 30) });
  const tight = makeRequest({ reqId: 'tight', start: north(10), arriveBy: at(8, 43) });

  const a = scorePairing(relaxed, offer, at(8), t)!;
  const b = scorePairing(tight, offer, at(8), t)!;

  it('tells apart two riders who cost the same minutes', () => {
    expect(b.driverAddedMinutes).toBeCloseTo(a.driverAddedMinutes);
    expect(b.offerScore).toBeLessThan(a.offerScore);
  });

  it('scores the driver side as 0.8 driving time + 0.2 slack', () => {
    // No extra driving either way, so driving time is a full 1.0 for both.
    // Slack: 20 min before either rider; 20 after the relaxed one, 1 after the tight one.
    expect(a.offerScore).toBeCloseTo(0.8 * 1 + 0.2 * 1);
    expect(b.offerScore).toBeCloseTo(0.8 * 1 + 0.2 * (1 / 20));
  });

  it("counts slack on the rider's side too", () => {
    expect(b.reqScore).toBeLessThan(a.reqScore);
  });
});
