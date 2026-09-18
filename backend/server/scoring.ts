import { coord, waypoint, trip, matchOffer, matchRequest, matchPairing, rideMatch } from "./updated matching.schema";

export { calcDriverScore };

// SCORING CONSTANTS
const DRIVING_TIME_FACTOR: number = 0.8;
const DR_SLACK_TIME_FACTOR: number = 0.2;
const P_SLACK_TIME_FACTOR: number = 0.6;
const PUNCTUALITY_FACTOR: number = 0.4;

// calculate how much of the detour time this passenger consumes (from [0, 1])
function calcDrivingTimeScore(d: matchOffer, p: matchRequest): number { }

// calculate how much slack time this passenger consumes (from [0, 1])
function calcSlackScore(d: matchOffer, p: matchRequest): number { }

// calculate how much buffer arrival time this passenger gets (from [0, 1])
function calcOnTimeScore(d: matchOffer, p: matchRequest): number { }

// calculate how much the driver wants this passenger (from [0, 1])
function calcDriverScore(d: matchOffer, p: matchRequest): number {
    const timeScore = calcDrivingTimeScore(d, p);
    const slackScore = calcSlackScore(d, p);
    const finalScore = DRIVING_TIME_FACTOR * timeScore + DR_SLACK_TIME_FACTOR * slackScore;

    return finalScore;
}

// calculate how much the passenger wants this driver (from [0, 1])
function calcPassengerScore(d: matchOffer, p: matchRequest): number {
    const onTimeScore = calcOnTimeScore(d, p);
    const slackScore = calcSlackScore(d, p);
    const finalScore = PUNCTUALITY_FACTOR * onTimeScore + P_SLACK_TIME_FACTOR * slackScore;

    return finalScore;
}
