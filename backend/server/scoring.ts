/**
 * This file contains functions to calculate the score values for a offer
 * and request pairing. 
 * This assumes that the additional passenger has already been inserted
 * into the trip at the optimal position, as expressed in the 'newTrip' variable.
 */

import { Coord, Trip, MatchOffer, MatchRequest } from "./matching.schema";

export { calcDriverScore, calcPassengerScore, UNI };

// SCORING CONSTANTS
const DRIVING_TIME_FACTOR: number = 0.8;
const DR_SLACK_TIME_FACTOR: number = 0.2;
const P_SLACK_TIME_FACTOR: number = 0.6;
const PUNCTUALITY_FACTOR: number = 0.4;

// LOCATION CONSTANT
const UNI: Coord = { lat: 0, lon: 0 };  // TODO: find actual value

// CONVERTSION CONSTANT
const MS_PER_MIN = 60000;

function getTimeFinder(toUni: boolean) {
  return (toUni)
    ? (t: Trip) => {
      const res = t.waypoints.reduce(
        ({ dur, prevTime }, p) => ({
          dur: dur + (p.latest.valueOf() - prevTime.valueOf()),
          prevTime: p.latest
        }
        ), { dur: 0, prevTime: t.waypoints[0].latest }
      );

      return res.dur / MS_PER_MIN;
    }
    : (t: Trip) => {
      const res = t.waypoints.reduce(
        ({ dur, prevTime }, p) => ({
          dur: dur + (p.earliest.valueOf() - prevTime.valueOf()),
          prevTime: p.earliest
        }
        ), { dur: 0, prevTime: t.waypoints[0].earliest }
      );

      return res.dur / MS_PER_MIN;
    };
}

// calculate how much of the (remaining) detour time this passenger consumes (from [0, 1])
function calcDrivingTimeScore(d: MatchOffer, newTrip: Trip): number {
  // find the max trip time for the driver
  const maxTripTime = d.directTime + d.window.maxDetour;

  // confirm one of the end points is actually uni
  if (d.end != UNI && d.start != UNI) throw new Error("Ride Offer was not to or from uni: "
    + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
  );

  // get current trip time
  const getTripTime: (t: Trip) => number = getTimeFinder(d.end == UNI);
  const currTime = getTripTime(d.currTrip);
  const newTime = getTripTime(newTrip);

  const currRemDetour = maxTripTime - currTime;
  const newRemDetour = maxTripTime - newTime;

  return newRemDetour / currRemDetour;
}

// calculate how much slack time this passenger consumes (from [0, 1])
function calcSlackScore(d: MatchOffer, newTrip: Trip): number {
  if (d.end == UNI) {
    // trip to uni - calculate from arrival (last waypoint)
    const l_ind = d.currTrip.waypoints.length - 1;
    const currUni = d.currTrip.waypoints[l_ind];
    const currSlack = currUni.latest.valueOf() - currUni.earliest.valueOf(); // ms

    const newUni = newTrip.waypoints[l_ind + 1];
    const newSlack = newUni.latest.valueOf() - newUni.earliest.valueOf(); // ms

    return newSlack / currSlack;
  } else if (d.start == UNI) {
    // trip from uni - calculate from depature (first waypoint)
    const currUni = d.currTrip.waypoints[0];
    const currSlack = currUni.latest.valueOf() - currUni.earliest.valueOf(); // ms

    const newUni = newTrip.waypoints[0 + 1];
    const newSlack = newUni.latest.valueOf() - newUni.earliest.valueOf(); // ms

    return newSlack / currSlack;
  } else {
    throw new Error("Ride Offer was not to or from uni: "
      + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
    );
  }
}

// calculate how much buffer arrival time this passenger gets (from [0, 1])
function calcOnTimeScore(p: MatchRequest, newTrip: Trip): number {
  // confirm one of the end points is actually uni
  if (p.end != UNI && p.start != UNI) throw new Error("Ride Offer was not to or from uni: "
    + `start=(${p.start.lat},${p.start.lon}) | end=(${p.end.lat},${p.end.lon})`
  );

  // find location of end point in trip
  const startInd = newTrip.waypoints
    .findIndex(wp => wp.loc.lat === p.start.lat && wp.loc.lon === p.start.lon);
  const endInd = newTrip.waypoints
    .findIndex(wp => wp.loc.lat === p.end.lat && wp.loc.lon === p.end.lon);

  // get the part of the trip the passenger is a part of
  const waypointSubset = newTrip.waypoints.slice(startInd, endInd + 1);
  const legsSubset = newTrip.legs.slice(startInd, endInd);

  const passTrip: Trip = {
    waypoints: waypointSubset,
    legs: legsSubset,
    currDur: -1,
  };
  // calculate the duration of this part of the trip
  passTrip.currDur = getTimeFinder(p.end == UNI)(passTrip);

  // determine how much buffer time the passenger could theoretically have
  const maxBuffer = (p.window.end.valueOf() - p.window.start.valueOf()) / MS_PER_MIN - passTrip.currDur;
  const uniqueWP = (p.end == UNI)
    ? newTrip.waypoints[startInd]
    : newTrip.waypoints[endInd];
  const currBuffer = (uniqueWP.latest.valueOf() - uniqueWP.earliest.valueOf()) / MS_PER_MIN;

  const score = currBuffer / maxBuffer;
  return score;
}

// calculate how much the driver wants this passenger (from [0, 1])
function calcDriverScore(d: MatchOffer, newTrip: Trip): number {
  const timeScore = calcDrivingTimeScore(d, newTrip);
  const slackScore = calcSlackScore(d, newTrip);
  const finalScore = DRIVING_TIME_FACTOR * timeScore + DR_SLACK_TIME_FACTOR * slackScore;

  return finalScore;
}

// calculate how much the passenger wants this driver (from [0, 1])
function calcPassengerScore(d: MatchOffer, p: MatchRequest, newTrip: Trip): number {
  const onTimeScore = calcOnTimeScore(p, newTrip);
  const slackScore = calcSlackScore(d, newTrip);
  const finalScore = PUNCTUALITY_FACTOR * onTimeScore + P_SLACK_TIME_FACTOR * slackScore;

  return finalScore;
}
