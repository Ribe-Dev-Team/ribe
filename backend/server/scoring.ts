/**
 * This file contains functions to calculate the score values for a offer
 * and request pairing. 
 * This assumes that the additional passenger has already been inserted
 * into the trip at the optimal position, as expressed in the 'newTrip' variable.
 */

import { Trip, MatchOffer, MatchRequest, type Waypoint } from "./matching.schema";
import { MS_PER_MIN } from "../../mobile/utility/times";
import { coordIsUni, coordToStr, sum } from "./matching";
import {
  DRIVING_TIME_FACTOR,
  DR_SLACK_TIME_FACTOR,
  P_SLACK_TIME_FACTOR,
  PUNCTUALITY_FACTOR,
} from "./scoringConst";

export {
  calcDrivingTimeScore,
  calcSlackScore,
  calcOnTimeScore,
  calcDriverScore,
  calcPassengerScore,
};

// calculate how much of the (remaining) detour time this passenger leaves for others (from [0, 1])
function calcDrivingTimeScore(d: MatchOffer, newTrip: Trip): number {
  // find the max trip time for the driver
  const maxTripTime = d.directTime + d.window.maxDetour;
  const currRemDetour = maxTripTime - d.currTrip.currDur;
  const newRemDetour = maxTripTime - newTrip.currDur;

  if (0 > currRemDetour) throw new Error(`Current trip has an invalid detour amount of ${currRemDetour} (shouldn't be less than 0)`);
  if (newRemDetour > currRemDetour) throw new Error(`Detour amount increased from ${currRemDetour} to ${newRemDetour} which should not be possible.`);

  return (0 > newRemDetour || 0 === currRemDetour) ? 0
    : newRemDetour / currRemDetour;
}

// calculate how much slack time this passenger leaves for others (from [0, 1])
function calcSlackScore(d: MatchOffer, newTrip: Trip): number {
  if (!coordIsUni(d.end) && !coordIsUni(d.start)) throw new Error("Ride Offer was not to or from uni: "
    + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
  );

  const l_ind = (coordIsUni(d.end))
    ? d.currTrip.waypoints.length - 1
    : 0;
  const currUni = d.currTrip.waypoints[l_ind];
  const currSlack = currUni.latest.valueOf() - currUni.earliest.valueOf(); // ms

  if (0 > currSlack) throw new Error(`Existing slack (${currSlack}) was negative which should not be possible.`);

  const new_ind = (coordIsUni(d.end))
    ? l_ind + 1
    : 0;
  const newUni = newTrip.waypoints[new_ind];
  const newSlack = newUni.latest.valueOf() - newUni.earliest.valueOf(); // ms

  if (newSlack > currSlack) throw new Error(`More stops cannot have less slack but slack time increased from ${currSlack} to ${newSlack}`);

  return (0 > newSlack || 0 === currSlack) ? 0
    : newSlack / currSlack;
}

// calculate how much buffer arrival time this passenger gets (from [0, 1])
function calcOnTimeScore(p: MatchRequest, newTrip: Trip): number {
  // find location of end point in trip
  const startInd = newTrip.waypoints
    .findIndex(wp => wp.loc.lat === p.start.lat && wp.loc.lon === p.start.lon);
  const endInd = newTrip.waypoints
    .findIndex(wp => wp.loc.lat === p.end.lat && wp.loc.lon === p.end.lon);

  if (startInd == -1 || endInd == -1) throw new Error(`One or more passenger endpoints could not be found. Passenger requested ${coordToStr(p.start)} -> ${coordToStr(p.end)} but couldn't find in waypoints: ${newTrip.waypoints.map(wp => coordToStr(wp.loc))}`);

  // get the part of the trip the passenger is a part of
  const legsSubset = newTrip.legs.slice(startInd, endInd);
  const passTransit = sum(legsSubset);

  // determine how much buffer time the passenger could theoretically have
  const maxBuffer = (p.window.end.valueOf() - p.window.start.valueOf()) / MS_PER_MIN - passTransit;
  const uniqueWP = (coordIsUni(p.end))
    ? newTrip.waypoints[startInd]
    : newTrip.waypoints[endInd];
  const currBuffer = (uniqueWP.latest.valueOf() - uniqueWP.earliest.valueOf()) / MS_PER_MIN;

  const score = currBuffer / maxBuffer;
  return score;
}

// calculate how much the driver wants this passenger (from [0, 1])
function calcDriverScore(d: MatchOffer, newTrip: Trip | null): number {
  if (newTrip == null) return 0;

  // confirm one of the end points is actually uni
  if (!coordIsUni(d.end) && !coordIsUni(d.start)) throw new Error("Ride Offer was not to or from uni: "
    + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
  );

  const timeScore = calcDrivingTimeScore(d, newTrip);
  const slackScore = calcSlackScore(d, newTrip);
  const finalScore = DRIVING_TIME_FACTOR * timeScore + DR_SLACK_TIME_FACTOR * slackScore;

  return finalScore;
}

// calculate how much the passenger wants this driver (from [0, 1])
function calcPassengerScore(d: MatchOffer, p: MatchRequest, newTrip: Trip | null): number {
  if (newTrip == null) return 0;

  // confirm one of the end points is actually uni
  if (!coordIsUni(d.end) && !coordIsUni(d.start)) throw new Error("Ride Offer was not to or from uni: "
    + `start=(${d.start.lat},${d.start.lon}) | end=(${d.end.lat},${d.end.lon})`
  );

  const onTimeScore = calcOnTimeScore(p, newTrip);
  const slackScore = calcSlackScore(d, newTrip);
  const finalScore = PUNCTUALITY_FACTOR * onTimeScore + P_SLACK_TIME_FACTOR * slackScore;

  return finalScore;
}
