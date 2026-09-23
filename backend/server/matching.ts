/**
 * This file contains functions to work with the objects in `./matching.schema.ts`
 */

import type { MatchOffer, MatchRequest, Trip } from "./matching.schema";
import { UNI } from "./scoring";

export function isTripToUni(t: Trip) {
  if (t.waypoints[-1].loc.lat === UNI.lat && t.waypoints[-1].loc.lon === UNI.lon) {
    return true;
  } else if (t.waypoints[0].loc.lat === UNI.lat && t.waypoints[0].loc.lon === UNI.lon) {
    return true;
  }
  throw new Error(`Could not determine trip was to/from uni: neither ${t.waypoints[-1].loc} or ${t.waypoints[0].loc} were found to be UNI - ${UNI}`);
}

export function isBookingToUni(r: MatchRequest | MatchOffer) {
  if (r.end.lat == UNI.lat && r.end.lon === UNI.lon) {
    return true;
  } else if (r.start.lat == UNI.lat && r.start.lon === UNI.lon) {
    return false;
  }
  throw new Error(`Could not determine if booking was to/from uni: neither ${r.start} or ${r.end} were found to be UNI - ${UNI}`);
}

