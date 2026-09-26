/**
 * This file contains functions to work with the objects in `./matching.schema.ts`
 */

import type { Coord, MatchOffer, MatchRequest, Trip } from "./matching.schema";
import { MONASH_CLAYTON_LOCATION } from "../../mobile/services/googlePlaces";

export function coordIsUni(c: Coord) {
  return c.lat === MONASH_CLAYTON_LOCATION.lat && c.lon === MONASH_CLAYTON_LOCATION.lng;
}

export function getEndTime(r: MatchRequest | MatchOffer) {
  return r.window.end;
}

export function getStartTime(r: MatchRequest | MatchOffer) {
  return r.window.start;
}

export function isTripToUni(t: Trip) {
  if (coordIsUni(t.waypoints[-1].loc)) {
    return true;
  } else if (coordIsUni(t.waypoints[0].loc)) {
    return true;
  }
  throw new Error(`Could not determine trip was to/from uni: neither ${t.waypoints[-1].loc} or ${t.waypoints[0].loc} were found to be UNI - ${MONASH_CLAYTON_LOCATION}`);
}

export function isBookingToUni(r: MatchRequest | MatchOffer) {
  if (coordIsUni(r.end)) {
    return true;
  } else if (coordIsUni(r.start)) {
    return false;
  }
  throw new Error(`Could not determine if booking was to/from uni: neither ${r.start} or ${r.end} were found to be UNI - ${MONASH_CLAYTON_LOCATION}`);
}

export function insertAt<T>(l: T[], add: T[], ind: number, replace: number = 0): T[] {
  const left = l.splice(0, ind);
  const right = l.splice(ind + replace, -1);
  const combined = [...left, ...add, ...right];
  return combined;
}

