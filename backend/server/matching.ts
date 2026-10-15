/**
 * This file contains functions to work with the objects in `./matching.schema.ts`
 */

import type { Coord, MatchOffer, MatchRequest, Trip } from "./matching.schema";
import { MONASH_CLAYTON_LOCATION } from "../../mobile/services/googlePlaces";

export const coordToStr: (c: Coord) => string = (c) => (`[lat=${c.lat}, long=${c.lon}]`);
const uniToStr = () => (`[lat=${MONASH_CLAYTON_LOCATION.lat}, long=${MONASH_CLAYTON_LOCATION.lng}]`);

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
  if (coordIsUni(t.waypoints.at(-1)!.loc)) {
    return true;
  } else if (coordIsUni(t.waypoints[0].loc)) {
    return false;
  }
  throw new Error(`Could not determine trip was to/from uni: neither ${coordToStr(t.waypoints[-1].loc)} or ${coordToStr(t.waypoints[0].loc)} were found to be UNI - ${uniToStr()}`);
}

export function isBookingToUni(r: MatchRequest | MatchOffer) {
  if (coordIsUni(r.end)) {
    return true;
  } else if (coordIsUni(r.start)) {
    return false;
  }
  throw new Error(`Could not determine if booking was to/from uni: neither ${coordToStr(r.start)} or ${coordToStr(r.end)} were found to be UNI - ${uniToStr()}`);
}

export function insertAt<T>(l: T[], add: T[], ind: number, replace: number = 0): T[] {
  if (l.length < ind) throw new Error(`Index out of range. Cannot insert to index ${ind} in list with ${l.length} elements.`);
  if (replace < 0) throw new Error(`Cannot replace negative number (${replace}) of items.`);
  if (l.length < ind + replace) throw new Error(`Index out of range. Tried to replace ${replace} items after index ${ind} but only ${l.length - ind} exist.`);
  const left = l.slice(0, ind);
  const right = l.slice(ind + replace);
  const combined = [...left, ...add, ...right];
  return combined;
}

export function min<T>(l: T[]): T {
  if (l.length === 0) throw new Error('No minimum of empty list');
  return l.reduce((acc, x) => (x < acc) ? x : acc, l[0]);
};

export function sum(l: number[]): number {
  if (l.length === 0) return 0;
  return l.reduce((acc, x) => acc + x, 0);
};

