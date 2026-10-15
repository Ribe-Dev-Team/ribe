import { MatchingConfig } from './types';

/**
 * How much detour a rider is assumed to tolerate, when we never asked them.
 *
 * Ribe does not collect a detour tolerance from riders - the booking form asks
 * only for date, earliest departure and latest arrival. This module supplies
 * the `maxDetour` that `MatchRequest` requires, derived from the rider's own
 * direct trip rather than taken from a form field.
 *
 * WHY A PERCENTAGE, NOT A CONSTANT
 *
 * A flat cap is blind to trip length: 15 minutes on a 10-minute trip is a 150%
 * detour, but on an hour-long trip it is 25%. SMART Goal 1 is stated as a
 * percentage of each rider's original trip, so a flat cap optimises against a
 * different quantity than the one being measured - and loses.
 *
 * Measured over 6 seeds, 100 riders / 30 drivers, scoring matches against
 * simulated true tolerances of 8-20 min that the algorithm never saw
 * ("would decline" = matched riders whose real tolerance was exceeded):
 *
 *   declared cap        matched  wouldDecline  netConfirmed  vsDirect
 *   ask the rider          70.5           0.0          70.5     19.0%
 *   flat 15 min            76.5           8.0          68.5     23.6%
 *   flat 20 min            80.5          10.5          70.0     25.4%
 *   35% of direct          65.8           1.2          64.7     11.2%
 *   40% of direct          71.2           2.5          68.7     14.4%   <-- chosen
 *   50% of direct          74.2           4.3          69.8     16.6%
 *   60% of direct          76.8           7.8          69.0     20.1%
 *
 * 40% is the largest share that still lands under the 15% goal. Net confirmed
 * matches are statistically tied with asking the rider (68.7 vs 70.5, well
 * inside seed variance), so the form field bought accuracy we could not
 * measure, at the cost of a question every rider had to answer.
 *
 * Note the headline `matched` number is NOT the thing to maximise: a looser cap
 * always raises it, because the extra matches are ones riders would reject. A
 * rejected match also holds its seat for the whole approval window, so it costs
 * more than the zero this table implies.
 *
 * THE FLOOR exists because a percentage collapses on short trips: 40% of a
 * 6-minute walk-to-campus trip is 2.4 minutes, tight enough that almost no
 * insertion is feasible and those riders never match at all.
 */
export function deriveRiderMaxDetour(
  directMinutes: number,
  cfg: Pick<MatchingConfig, 'riderDetourPercent' | 'riderDetourFloorMinutes'>,
): number {
  if (!Number.isFinite(directMinutes) || directMinutes <= 0) {
    return cfg.riderDetourFloorMinutes;
  }
  return Math.max(cfg.riderDetourFloorMinutes, directMinutes * cfg.riderDetourPercent);
}
