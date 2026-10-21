import type { Coord } from './matching.schema';
import type { RoadDistanceMatrix } from './matching/types';

export const EMISSIONS_KG_PER_KM = 0.17;

/** Emissions for one solo trip, rounded to the tenth of a kilogram. */
export function emissionsForDistanceKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new Error(`Distance must be a finite non-negative number, but was ${distanceKm}`);
  }
  return Math.round((distanceKm * EMISSIONS_KG_PER_KM + Number.EPSILON) * 10) / 10;
}

/** Sum each rider's solo-trip emissions using the matching run's road matrix. */
export function emissionsForRiders(
  riderHomes: Coord[],
  campus: Coord,
  toUni: boolean,
  distances: RoadDistanceMatrix,
): number {
  const total = riderHomes.reduce((sum, home) => {
    const distanceKm = toUni ? distances.km(home, campus) : distances.km(campus, home);
    return sum + emissionsForDistanceKm(distanceKm);
  }, 0);
  return Math.round((total + Number.EPSILON) * 10) / 10;
}