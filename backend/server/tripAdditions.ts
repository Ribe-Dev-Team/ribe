/**
 * This file contains functions to find the optimal position to add the additional
 * passenger into the trip.
 * This is done through a geographical heuristic (least sum of new distances).
 */

import type { MatchRequest, Trip, Waypoint } from "./matching.schema";
import { calcDist } from "../../mobile/utility/distances";
import { UNI } from "./scoring";
import { isBookingToUni } from "./matching";

/**
 * Find earliest and latest departure at each waypoint using forwards and backwards scanning
 * (https://www.monash.edu/student-academic-success/mathematics/graphs-and-networks/directed-networks/forward-and-backward-scanning)
 * 
 * @param {boolean} toUni true if the trip is going to uni
 * @param {Waypoint[]} wps the list of waypoints
 * @param {number[]} legs the list of times to travel between each waypoint
 * @returns {Waypoint[]} the updated waypoints
 */
function scanTrip(req: MatchRequest, wps: Waypoint[], legs: number[]): Waypoint[] {
}

/**
 * Add the passenger into the current trip/route in the optimal position
 * Note: the Trip object does not keep track of who each waypoint belows to
 * 
 * @param {Trip} curr the current Trip
 * @param {MatchRequest} p the passenger's request to incorporate
 * @returns {Trip} the new Trip
 */
export function addPassenger(curr: Trip, p: MatchRequest): Trip {
  // get the end-point that isn't shared/uni
  const isToUni = p.end == UNI;
  const pUnique = isToUni ? p.start : p.end;
  // calculate distances between current waypoints and new waypoint
  const distances = curr.waypoints.map(wp => calcDist(wp.loc, pUnique));
  // add pairs of distances to compare the detour amount
  const [, ...detours] = distances // ignore first entry (NaN - indexing)
    .map((dist, ind) => dist + distances[ind - 1]); // add adjacenct distances
  const minDetour = detours.reduce((acc, d) => (d < acc) ? d : acc, Infinity);
  const bestInd = detours
    .map((det, ind) => ({ detour: det, index: ind }))
    .filter(x => x.detour === minDetour)[0].index;

  // insert new waypoint after `bestInd`
  const newStop = {
    loc: pUnique,
    earliest: p.window.start,
    latest: p.window.end,
  };
  const beforeAdd = curr.waypoints.slice(0, bestInd + 1);
  const afterAdd = curr.waypoints.slice(bestInd + 1, -1);
  const newWaypoints = [...beforeAdd, newStop, ...afterAdd];

  // call Google API for new distances and times
  const toAddTime = undefined;
  const toAddDist = undefined;
  const fromAddTime = undefined;
  const fromAddDist = undefined;

  // find earliest and latest departure using forwards and backwards scanning
  // 


  // finalise trip object
  const beforeLegs = curr.legs.slice(0, bestInd); // exclude the index at `bestIndex`
  const afterLegs = curr.legs.slice(bestInd + 1, -1);
  const beforeLegDists = curr.legDists.slice(0, bestInd);
  const afterLegDists = curr.legDists.slice(bestInd + 1, -1);

  const newLegs = [...beforeLegs, toAddTime, fromAddTime, ...afterLegs];
  const newLegDists = [...beforeLegDists, toAddDist, fromAddDist, ...afterLegDists];

  const newDuration = curr.currDur - curr.legs[bestInd] + toAddTime + fromAddTime;
  const newDistance = curr.currDist - curr.legDists[bestInd] + toAddDist + fromAddDist;

  const newTrip = {
    waypoints: newWaypoints,
    legs: newLegs,
    legDists: newLegDists,
    currDur: newDuration,
    currDist: newDistance,
  };
  return newTrip;
}
