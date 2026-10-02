/**
 * This file contains functions to find the optimal position to add the additional
 * passenger into the trip.
 * This is done through a geographical heuristic (least sum of new distances).
 */

import type { MatchRequest, Trip, Waypoint } from "./matching.schema";
import { calcDist } from "../../mobile/utility/distances";
import { subMins, addMins } from "../../mobile/utility/times";
import { getEndTime, getStartTime, insertAt, isBookingToUni } from "./matching";
import { GOOGLE_MAPS_API_KEY, isPlacesConfigured } from '../../mobile/services/googlePlaces';
import { RoutesReqOptions, computeRoute } from "../../mobile/services/googleRoutes";

/**
 * Find earliest and latest departure at each waypoint using forwards and backwards scanning
 * (https://www.monash.edu/student-academic-success/mathematics/graphs-and-networks/directed-networks/forward-and-backward-scanning)
 * 
 * @param {MatchRequest} req the details from the new ride request
 * @param {Waypoint[]} wps the list of waypoints
 * @param {number[]} legs the list of times to travel between each waypoint
 * @returns {Waypoint[] | null} the updated waypoints or null if the additional passenger isn't feasible
 */
export function scanTripToUni(req: MatchRequest, wps: Waypoint[], legs: number[]): Waypoint[] | null {
  //validate
  if (wps.length < 2) throw new Error("Found less than 2 waypoints so driver details have not been properly stored in waypoint list: " + `${wps.map(w => [w.loc, w.earliest, w.latest])}`);
  if (wps.length - 1 !== legs.length) throw new Error(`Number of waypoints and number of legs didn't match. ${wps.length} waypoints should have ${wps.length - 1} legs but received ${legs.length} instead.`);
  if (legs.some(l => l < 0)) throw new Error(`Cannot have negative travel time for any legs: ${legs}`);

  // sharing uni arrival time - get earliest
  const arrTime = (getEndTime(req) < wps[wps.length - 1].latest)
    ? getEndTime(req)  // new passenger has a stricter arrival time
    : wps[wps.length - 1].latest; // else, arrival time is unchanged

  // work from end -> start
  const revLegs = [...legs].reverse();
  const revTravelTime = revLegs.reduce((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
  const revWps = [...wps].reverse();
  const revEndpoints = revWps.map((wp, ind) => ({ ...wp, latest: subMins(arrTime, revTravelTime[ind]) }));
  const newEndpoints = [...revEndpoints].reverse();
  // work from start -> end
  const newWaypoints = newEndpoints.reduce((acc: Waypoint[], wp, ind) => {
    if (ind === 0) return [...acc, wp]; // dep time is unchanged for the driver's departure

    const driverArr = addMins(acc[acc.length - 1].earliest, legs[ind - 1]);
    const passArr = wp.earliest;
    const newEarliest = (driverArr > passArr) ? driverArr : passArr;
    return [...acc, { ...wp, earliest: newEarliest }];
  }, []);

  // validate everyone still has a travel window
  if (!newWaypoints.every(p => p.latest >= p.earliest)) return null;

  return newWaypoints;
}

/**
 * Same process as above, just for trips back from uni
 * 
 * @param {Waypoint[]} wps the list of waypoints
 * @param {number[]} legs the list of times to travel between each waypoint
 * @returns {Waypoint[] | null} the updated waypoints or null if the additional passenger isn't feasible
 */
export function scanTripFromUni(req: MatchRequest, wps: Waypoint[], legs: number[]): Waypoint[] | null {
  // sharing uni departure time - get latest
  const depTime = (getStartTime(req) > wps[0].earliest)
    ? getStartTime(req) // new passenger has a stricter departure time
    : wps[0].earliest;

  // work from start -> end
  const travelTime = legs.reduce((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
  const earliest = wps.map((wp, ind) => ({ ...wp, latest: addMins(depTime, travelTime[ind]) }));

  // work from end -> start
  const revEarliest = [...earliest].reverse();
  const newWaypoints = revEarliest.reduce((acc: Waypoint[], wp, ind) => {
    if (ind === 0) return [...acc, wp]; // arr time is unchanged for the driver's arrival

    const driverLatest = addMins(acc[acc.length - 1].latest, legs[ind - 1]);
    const passLatest = wp.latest;
    const newLatest = (driverLatest < passLatest) ? driverLatest : passLatest;
    return [...acc, { ...wp, latest: newLatest }];
  }, []).reverse();

  // validate everyone still has a travel window
  if (!newWaypoints.every(p => p.latest >= p.earliest)) return null;

  return newWaypoints;
}

/**
 * Add the passenger into the current trip/route in the optimal position
 * Note: the Trip object does not keep track of who each waypoint belows to
 * 
 * @param {Trip} curr the current Trip
 * @param {MatchRequest} p the passenger's request to incorporate
 * @returns {Trip | null} the new Trip or null if adding the passenger isn't possible
 */
export async function addPassenger(curr: Trip, p: MatchRequest): Promise<Trip | null> {
  // get the end-point that isn't shared/uni
  const pUnique = isBookingToUni(p) ? p.start : p.end;
  // calculate distances between current waypoints and new waypoint
  const distances = curr.waypoints.map(wp => calcDist(wp.loc, pUnique));
  // add pairs of distances to compare the detour amount
  const [, ...detours] = distances // ignore first entry (NaN - due to index-1)
    .map((dist, ind) => dist + distances[ind - 1]); // add adjacenct distances
  const minDetour = detours.reduce((acc, d) => (d < acc) ? d : acc, Infinity);
  const bestInd = detours
    .map((det, ind) => ({ detour: det, index: ind }))
    .filter(x => x.detour === minDetour)[0].index;

  // validate `bestInd` in appropriate range
  if (bestInd < 1 || bestInd >= curr.waypoints.length) throw new Error(`Insertion index of '${bestInd}' was out of bounds for current trip of [0..${curr.waypoints.length - 1}] waypoints. (First and last waypoint must remain unchanged).`);

  // insert new waypoint after `bestInd`
  const newStop = {
    loc: pUnique,
    earliest: getStartTime(p),
    latest: getEndTime(p),
  };
  const newWaypoints = insertAt(curr.waypoints, [newStop], bestInd + 1);

  // call Google API for new distances and times
  if (!isPlacesConfigured) throw new Error("Google API key was not properly configured. Could not retrieve travel data.");

  const routeReq: RoutesReqOptions = {
    origin: newWaypoints[bestInd - 1].loc,
    dest: newWaypoints[bestInd + 1].loc,
    inters: [newWaypoints[bestInd].loc],
    depTime: newWaypoints[bestInd - 1].earliest,
    apiKey: GOOGLE_MAPS_API_KEY,
    fieldMask: "routes.legs.duration,routes.legs.distanceMeters",
  };

  const routeObj = await computeRoute(routeReq);
  // there should only ever be 1 route option returned
  const [leg1, leg2] = routeObj.routes[0].legs;
  // --- FORMAT ---
  // leg: {
  //   "distanceMeters": 1234,
  //   "duration": "905s"  <- note: duration is not a number
  // }
  const toAddTime = parseInt(leg1.duration) / 60;
  const toAddDist = parseInt(leg1.distanceMeters);
  const fromAddTime = parseInt(leg2.duration) / 60;
  const fromAddDist = parseInt(leg2.distanceMeters);

  // replace old leg with two new legs
  const newDuration = curr.currDur - curr.legs[bestInd] + toAddTime + fromAddTime;
  const newDistance = curr.currDist - curr.legDists[bestInd] + toAddDist + fromAddDist;

  // finalise trip object
  const newLegs = insertAt(curr.legs, [toAddTime, fromAddTime], bestInd, 1);
  const newLegDists = insertAt(curr.legDists, [toAddDist, fromAddDist], bestInd, 1);

  // find earliest and latest departure using forwards and backwards scanning
  const updatedWaypoints = (isBookingToUni(p))
    ? scanTripToUni(p, newWaypoints, newLegs)
    : scanTripFromUni(p, newWaypoints, newLegs);

  if (updatedWaypoints === null) return null;

  const newTrip = {
    waypoints: newWaypoints,
    legs: newLegs,
    legDists: newLegDists,
    currDur: newDuration,
    currDist: newDistance,
  };
  return newTrip;
}
