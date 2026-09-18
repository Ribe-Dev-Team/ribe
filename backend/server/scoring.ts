import { coord, waypoint, trip, matchOffer, matchRequest, matchPairing, rideMatch } from "./updated matching.schema";

export { calcDriverScore };

// SCORING CONSTANTS
const DRIVING_TIME_FACTOR: number = 0.8;
const DR_SLACK_TIME_FACTOR: number = 0.2;
const P_SLACK_TIME_FACTOR: number = 0.6;
const PUNCTUALITY_FACTOR: number = 0.4;

// LOCATION CONSTANT
const UNI: coord = { lat: 0, lon: 0 };

// CONVERTSION CONSTANT
const MS_PER_MIN = 60000;

function dummyGoogleAPI(start: coord, end: coord, depAt: Date) {
    return 1;
}

// calculate how much of the (remaining) detour time this passenger consumes (from [0, 1])
function calcDrivingTimeScore(d: matchOffer, p: matchRequest, newTrip: trip): number {
    // find the max trip time for the driver
    const maxTripTime = d.directTime + d.travelWindow.maxDetour;

    // get current trip time
    let getTripTime: (t: trip) => number;
    if (d.end == UNI) {
        // trip to uni - calculate from latest times
        getTripTime = (t: trip) => {
            const res = t.waypoints.reduce(
                ({ dur, prevTime }, p) => ({
                    dur: dur + (p.latest.valueOf() - prevTime.valueOf()),
                    prevTime: p.latest
                }
                ), { dur: 0, prevTime: t.waypoints[0].latest }
            );

            return res.dur / MS_PER_MIN;
        };
    } else if (d.start == UNI) {
        // trip from uni - calculate from earliest times
        getTripTime = (t: trip) => {
            const res = t.waypoints.reduce(
                ({ dur, prevTime }, p) => ({
                    dur: dur + (p.earliest.valueOf() - prevTime.valueOf()),
                    prevTime: p.earliest
                }
                ), { dur: 0, prevTime: t.waypoints[0].earliest }
            );

            return res.dur / MS_PER_MIN;
        };
    } else {
        throw new Error("Ride Offer was not to or from uni: "
            + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
        );
    }

    const currTime = getTripTime(d.currTrip);
    const newTime = getTripTime(newTrip);

    const currRemDetour = maxTripTime - currTime;
    const newRemDetour = maxTripTime - newTime;

    return newRemDetour / currRemDetour;
}

// calculate how much slack time this passenger consumes (from [0, 1])
function calcSlackScore(d: matchOffer, p: matchRequest, newTrip: trip): number { }

// calculate how much buffer arrival time this passenger gets (from [0, 1])
function calcOnTimeScore(d: matchOffer, p: matchRequest, newTrip: trip): number { }

// calculate how much the driver wants this passenger (from [0, 1])
function calcDriverScore(d: matchOffer, p: matchRequest, newTrip: trip): number {
    const timeScore = calcDrivingTimeScore(d, p, newTrip);
    const slackScore = calcSlackScore(d, p, newTrip);
    const finalScore = DRIVING_TIME_FACTOR * timeScore + DR_SLACK_TIME_FACTOR * slackScore;

    return finalScore;
}

// calculate how much the passenger wants this driver (from [0, 1])
function calcPassengerScore(d: matchOffer, p: matchRequest, newTrip: trip): number {
    const onTimeScore = calcOnTimeScore(d, p, newTrip);
    const slackScore = calcSlackScore(d, p, newTrip);
    const finalScore = PUNCTUALITY_FACTOR * onTimeScore + P_SLACK_TIME_FACTOR * slackScore;

    return finalScore;
}
