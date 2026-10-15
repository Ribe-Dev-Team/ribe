import { Coord } from "../backend/server/matching.schema";

export const calcDist = jest.fn();
export const euclid = (a: Coord, b: Coord) => Math.hypot(a.lat - b.lat, a.lon - b.lon);
export function resetDistancesMock() {
    calcDist.mockReset();
    calcDist.mockImplementation(euclid);
}
