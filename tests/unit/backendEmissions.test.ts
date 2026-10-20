import { emissionsForDistanceKm, emissionsForRiders } from '../../backend/server/emissions';
import { Coord } from '../../backend/server/matching.schema';
import { RoadDistanceMatrix } from '../../backend/server/matching/types';

const campus = { lat: 0, lon: 0 };
const riderOne = { lat: 1, lon: 1 };
const riderTwo = { lat: 2, lon: 2 };

function roadDistances(legs: Array<[Coord, Coord, number]>): RoadDistanceMatrix {
  const key = (from: Coord, to: Coord) => `${from.lat},${from.lon}>${to.lat},${to.lon}`;
  const values = new Map(legs.map(([from, to, km]) => [key(from, to), km]));
  return {
    km: (from, to) => {
      const km = values.get(key(from, to));
      if (km === undefined) throw new Error(`No fixture distance for ${key(from, to)}`);
      return km;
    },
  };
}

describe('backend emissions', () => {
  it('converts a routed solo distance to emissions', () => {
    expect(emissionsForDistanceKm(10)).toBe(1.7);
  });

  it('sums each rider solo emission and excludes the driver', () => {
    const distances = roadDistances([
      [riderOne, campus, 10],
      [riderTwo, campus, 20],
    ]);

    expect(emissionsForRiders([riderOne, riderTwo], campus, true, distances)).toBe(5.1);
  });

  it('uses campus-to-home road distances when traveling from campus', () => {
    const distances = roadDistances([
      [campus, riderOne, 10],
      [campus, riderTwo, 20],
    ]);

    expect(emissionsForRiders([riderOne, riderTwo], campus, false, distances)).toBe(5.1);
  });
});