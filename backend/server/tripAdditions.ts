/**
 * This file contains functions to find the optimal position to add the additional
 * passenger into the trip.
 * This is done through a geographical heuristic (least sum of new distances).
 */

import type { MatchRequest, Trip, Waypoint, Coord } from "./matching.schema";
import { calcDist } from "../../mobile/utility/distances";
import { subMins, addMins } from "../../mobile/utility/times";
import { getEndTime, getStartTime, insertAt, isBookingToUni, min } from "./matching";
import { GOOGLE_MAPS_API_KEY, isPlacesConfigured } from '../../mobile/services/googlePlaces';
import { RoutesReqOptions, computeRoute } from "../../mobile/services/googleRoutes";
import { formatDateTimeToStr } from "../../mobile/utility/dates";

const coordToStr: (c: Coord) => string = (c) => (`[lat=${c.lat}, long=${c.lon}]`);

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
 * @param {MatchRequest} req the details from the new ride request
 * @param {Waypoint[]} wps the list of waypoints
 * @param {number[]} legs the list of times to travel between each waypoint
 * @returns {Waypoint[] | null} the updated waypoints or null if the additional passenger isn't feasible
 */
export function scanTripFromUni(req: MatchRequest, wps: Waypoint[], legs: number[]): Waypoint[] | null {
  //validate
  if (wps.length < 2) throw new Error("Found less than 2 waypoints so driver details have not been properly stored in waypoint list: " + `${wps.map(w => [w.loc, w.earliest, w.latest])}`);
  if (wps.length - 1 !== legs.length) throw new Error(`Number of waypoints and number of legs didn't match. ${wps.length} waypoints should have ${wps.length - 1} legs but received ${legs.length} instead.`);
  if (legs.some(l => l < 0)) throw new Error(`Cannot have negative travel time for any legs: ${legs}`);

  // sharing uni departure time - get latest
  const depTime = (getStartTime(req) > wps[0].earliest)
    ? getStartTime(req) // new passenger has a stricter departure time
    : wps[0].earliest;

  // work from start -> end
  const travelTime = legs.reduce((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
  const earliest = wps.map((wp, ind) => ({ ...wp, earliest: addMins(depTime, travelTime[ind]) }));

  // work from end -> start
  const revLegs = [...legs].reverse();
  const revEarliest = [...earliest].reverse();
  const newWaypoints = revEarliest.reduce((acc: Waypoint[], wp, ind) => {
    if (ind === 0) return [...acc, wp]; // arr time is unchanged for the driver's arrival

    const driverLatest = subMins(acc[acc.length - 1].latest, revLegs[ind - 1]);
    const passLatest = wp.latest;
    const newLatest = (driverLatest < passLatest) ? driverLatest : passLatest;
    return [...acc, { ...wp, latest: newLatest }];
  }, []).reverse();

  // validate everyone still has a travel window
  if (!newWaypoints.every(p => p.latest >= p.earliest)) return null;

  return newWaypoints;
}

/**
 * Calculate the extra distance needed to travel for each insertion point in the trip
 * 
 * @param {Waypoint[]} wps the list of waypoints currently in the trip
 * @param {Coord} add the new location to add to the trip
 * @returns a list of detour values for each insertion point
 */
export function calcDetours(wps: Waypoint[], add: Coord) {
  const distances = wps.map(wp => calcDist(wp.loc, add));

  const currLegDists =
    wps.slice(1)  // skip index 0
      .map((wp, ind) => calcDist(wp.loc, wps[ind].loc));

  // add pairs of distances to compare the detour amount
  return distances.slice(1) // skip index 0
    .map((dist, ind) => dist + distances[ind] - currLegDists[ind + 1]); // add adjacenct distances and sub existing distance
}

/**
 * Find the insertion point that minimises the additional travel distance
 * 
 * @param {Waypoint} add the new waypoint to add the the trip
 * @param {Waypoint[]} wps the ordered list of current waypoints
 * @returns a validated index to insert the new waypoint at
 */
export function findBestInd(add: Waypoint, wps: Waypoint[]) {
  const detours = calcDetours(wps, add.loc);
  const minDetour = min(detours);
  const bestInd = detours
    .map((det, ind) => ({ detour: det, index: ind }))
    .filter(x => x.detour === minDetour)[0].index;

  // validate `bestInd` in appropriate range
  if (bestInd < 0 || bestInd >= wps.length) throw new Error(`Insertion after index '${bestInd}' was out of bounds for current trip of [0..${wps.length}] waypoints. (First and last waypoint must remain unchanged).`);

  return bestInd;
}

export function updateLegDists(currTrip: Trip, newLegs: { distanceMeters: number, duration: string; }[], ind: number) {
  const [leg1, leg2] = newLegs;
  // --- FORMAT ---
  // leg: {
  //   "distanceMeters": 1234,
  //   "duration": "905s"
  // }
  const toAddDist = Number(leg1.distanceMeters);
  const fromAddDist = Number(leg2.distanceMeters);

  // replace old leg with two new legs
  const newDistance = currTrip.currDist - currTrip.legDists[ind] + toAddDist + fromAddDist;

  // finalise trip object
  const newLegDists = insertAt(currTrip.legDists, [toAddDist, fromAddDist], ind, 1);

  return {
    ...currTrip,
    currDist: newDistance,
    legDists: newLegDists,
  };
}

export function updateLegDurs(currTrip: Trip, newLegs: { distanceMeters: number, duration: string; }[], ind: number): Trip {
  const [leg1, leg2] = newLegs;
  // --- FORMAT ---
  // leg: {
  //   "distanceMeters": 1234,
  //   "duration": "905s"  <- note: duration is not a number
  // }
  const toAddTime = Math.ceil(parseInt(leg1.duration) / 60); // time in integer minutes
  const fromAddTime = Math.ceil(parseInt(leg2.duration) / 60); // Math.ceil to overestimate

  // update totals
  const newDur = currTrip.currDur - currTrip.legs[ind] + toAddTime + fromAddTime;

  // add new legs
  const newList = insertAt(currTrip.legs, [toAddTime, fromAddTime], ind, 1);
  return {
    ...currTrip,
    currDur: newDur,
    legs: newList,
  };
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
  // validate trip is populated
  if (curr.waypoints.length < 2 || curr.legs.length < 1 || curr.legDists.length < 1) throw new Error(`Current trip was not adequately populated. Found only ${curr.waypoints.length} waypoints (min 2), ${curr.legs.length < 1} leg times (min 1) and ${curr.legDists.length} leg distances (min 1)`);
  if (curr.waypoints.some(wp => wp === undefined)) throw new Error('Found an undefined waypoint in list:' + curr.waypoints.map((wp, i) => `\nWP#${i}-${coordToStr(wp.loc)}-[${formatDateTimeToStr(wp.earliest)} -> ${formatDateTimeToStr(wp.latest)}]`));

  const newStop = {
    // get the end-point that isn't shared/uni
    loc: isBookingToUni(p) ? p.start : p.end,
    earliest: getStartTime(p),
    latest: getEndTime(p),
  };

  // get minimum detour -> insertion point
  const bestInd = findBestInd(newStop, curr.waypoints);
  // insert new waypoint after `bestInd`
  const newWaypoints = insertAt(curr.waypoints, [newStop], bestInd);

  // call Google API for new distances and times
  if (!isPlacesConfigured()) throw new Error("Google API key was not properly configured. Could not retrieve travel data.");

  const routeReq: RoutesReqOptions = {
    origin: newWaypoints[bestInd].loc,
    dest: newWaypoints[bestInd + 2].loc,
    inters: [newWaypoints[bestInd + 1].loc],
    depTime: newWaypoints[bestInd].earliest,
    apiKey: GOOGLE_MAPS_API_KEY,
    fieldMask: "routes.legs.duration,routes.legs.distanceMeters",
  };

  const routeObj = await computeRoute(routeReq);
  const apiLegs = routeObj.routes[0].legs;

  // update Trip object
  const withDur = updateLegDurs({ ...curr, waypoints: newWaypoints }, apiLegs, bestInd);
  const newTrip = updateLegDists(withDur, apiLegs, bestInd);

  // find earliest and latest departure using forwards and backwards scanning
  const validWaypoints = (isBookingToUni(p))
    ? scanTripToUni(p, newWaypoints, newTrip.legs)
    : scanTripFromUni(p, newWaypoints, newTrip.legs);

  if (validWaypoints === null) return null;

  return { ...newTrip, waypoints: validWaypoints };
}
