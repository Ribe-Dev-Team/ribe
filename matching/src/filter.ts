import {
  Coord, MatchOffer, MatchRequest, MatchingConfig,
  RejectedPairing, RejectReason,
} from './types';
import { bearingDegrees, bearingDifference, haversineKm } from './geo';
import { isAcceptingRiders, minutesToDeparture } from './route';

/** The end of a rider's trip that is NOT campus — the point the driver deviates to. */
export function waypointOf(req: MatchRequest): Coord {
  return req.direction === 'TO_CAMPUS' ? req.start : req.end;
}

/** KEY-133. Two windows overlap unless one ends before the other begins. */
export function windowsOverlap(req: MatchRequest, offer: MatchOffer): boolean {
  if (req.travelWindow.end < offer.travelWindow.start) return false;
  if (req.travelWindow.start > offer.travelWindow.end) return false;
  return true;
}

/** KEY-134. Campus is the common endpoint, so direction reduces to one flag. */
export function directionsCompatible(req: MatchRequest, offer: MatchOffer): boolean {
  return req.direction === offer.direction;
}

/** Gender preference is MUTUAL. Checking only the rider's side is the classic bug. */
export function genderCompatible(req: MatchRequest, offer: MatchOffer): boolean {
  const r = req.preferences.genderPreference;
  const o = offer.preferences.genderPreference;
  if (r === 'WOMEN_ONLY' && offer.driverGender !== 'F') return false;
  if (r === 'MEN_ONLY'   && offer.driverGender !== 'M') return false;
  if (o === 'WOMEN_ONLY' && req.riderGender   !== 'F') return false;
  if (o === 'MEN_ONLY'   && req.riderGender   !== 'M') return false;
  return true;
}

/**
 * KEY-136. Bearing gate.
 *
 * Applied ONLY when the driver has nobody on board yet. A bearing describes a
 * single segment; once there is a waypoint the route is multi-segment and no
 * single bearing describes it — which is exactly the situation KEY-138 creates.
 *
 * Also note the threshold has no fixed physical meaning: for two points at
 * distance r from campus, separation is 2r*sin(theta/2). A 45 deg gate permits
 * 0.77 km of separation 1 km out but 15.3 km at 20 km out. Keep the threshold
 * loose and let the corridor test below do the real work.
 */
export function bearingCompatible(
  req: MatchRequest, offer: MatchOffer, cfg: MatchingConfig,
): boolean {
  if (!cfg.useBearingFilter) return true;
  if (offer.onBoard.length > 0) return true;

  const rb = bearingDegrees(req.start, req.end);
  const ob = bearingDegrees(offer.start, offer.end);
  return bearingDifference(rb, ob) <= cfg.bearingThresholdDegrees;
}

/**
 * Corridor test. Measures what inserting the rider COSTS, rather than how far
 * away they are — a rider 5 km ahead on the route is nearly free, one 5 km
 * behind is expensive, and a plain distance check cannot tell them apart.
 *
 * By the triangle inequality this is always >= 0, approaching 0 when the rider
 * sits on the driver's straight-line path. Heuristic, not a bound: hence the
 * road slack factor.
 */
export function corridorDetourKm(req: MatchRequest, offer: MatchOffer): number {
  const w = waypointOf(req);
  return (
    haversineKm(offer.start, w) +
    haversineKm(w, offer.end) -
    haversineKm(offer.start, offer.end)
  );
}

export interface FilterResult {
  candidates: Array<{ req: MatchRequest; offer: MatchOffer }>;
  rejected: RejectedPairing[];
}

/**
 * KEY-137. Build the compatible pair list, keeping rejects for debugging and
 * for the batch report.
 *
 * Ordered cheapest test first: every pair killed here is one that never
 * reaches a travel-time lookup.
 */
export function hardFilter(
  requests: MatchRequest[],
  offers: MatchOffer[],
  cfg: MatchingConfig,
  departAt: Date,
  now: Date,
  avgSpeedKmh = 40,
): FilterResult {
  const candidates: FilterResult['candidates'] = [];
  const rejected: RejectedPairing[] = [];
  const reject = (offer: MatchOffer, req: MatchRequest, reason: RejectReason) =>
    rejected.push({ offerId: offer.offerId, reqId: req.reqId, reason });

  for (const offer of offers) {
    if (offer.status !== 'open') {
      for (const req of requests) reject(offer, req, 'OFFER_NOT_OPEN');
      continue;
    }
    if (!isAcceptingRiders(offer, cfg, departAt, now)) {
      const why: RejectReason =
        offer.seatsFilled >= offer.seatsOffered ? 'NO_SEATS' :
        minutesToDeparture(departAt, now) <= cfg.matchingCutoffMinutes ? 'MATCHING_CUTOFF' :
        'DRIVER_CLOSED';
      for (const req of requests) reject(offer, req, why);
      continue;
    }

    for (const req of requests) {
      if (req.status !== 'unassigned') continue;
      if (req.riderId === offer.driverId) { reject(offer, req, 'SAME_PERSON'); continue; }
      if (!directionsCompatible(req, offer)) { reject(offer, req, 'DIRECTION'); continue; }
      if (!windowsOverlap(req, offer))       { reject(offer, req, 'TIME_WINDOW'); continue; }
      if (!genderCompatible(req, offer))     { reject(offer, req, 'GENDER_PREF'); continue; }
      if (req.preferences.luggage && !offer.preferences.luggage) {
        reject(offer, req, 'LUGGAGE'); continue;
      }
      if (!bearingCompatible(req, offer, cfg)) { reject(offer, req, 'BEARING'); continue; }

      const detourKm = corridorDetourKm(req, offer);
      const budgetKm = (req.maxDetour / 60) * avgSpeedKmh;
      if (detourKm > budgetKm * cfg.roadSlackFactor) {
        reject(offer, req, 'CORRIDOR'); continue;
      }

      candidates.push({ req, offer });
    }
  }

  return { candidates, rejected };
}
