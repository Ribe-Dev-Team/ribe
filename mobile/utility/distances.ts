/*
Utility file to handle generic distance functions.
*/
export { calcDist };

interface coord { lat: number, lon: number; };

/* Calculate cartesian distance (pythag) - ignore curvature of the earth */
function calcDist(a: coord, b: coord) {
    return ((a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2) ** (1 / 2);
}
