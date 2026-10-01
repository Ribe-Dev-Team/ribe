/*
Live check against the real Google APIs - `npm run test:live`. Not part of
`npm test`: it needs a key, network access, and it is billed (one 2x2 matrix,
4 elements per API, well inside the free monthly tier).

The other travel-time tests run against fakes built from Google's docs, so they
prove each client matches its fake. This proves the fakes match Google: the
request is accepted and the response is read the way the client expects. Bounds
are loose on purpose - traffic varies.

Both clients the runner can use are covered: Distance Matrix (the default - the
API Ribe's key has enabled; legacy, so only projects that used it before March
2025 can) and Routes (`npm run match -- --routes`, needs the Routes API
enabled). One failing while the other passes says which API the key's project
has enabled.
*/
import { MONASH_CLAYTON } from '../src/adapter';
import { buildGoogleTravelTimeMatrix, buildRoutesTravelTimeMatrix } from '../src/travelTime';
import { envValue } from '../runner/env';

const BOX_HILL = { lat: -37.8189, lon: 145.1218 }; // ~10 km north of campus

describe.each([
  ['Routes API', buildRoutesTravelTimeMatrix],
  ['Distance Matrix API (legacy)', buildGoogleTravelTimeMatrix],
])('Google %s (live)', (_name, buildMatrix) => {
  it('returns plausible drive times both ways between campus and Box Hill', async () => {
    const apiKey = envValue('GOOGLE_MAPS_API_KEY', 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      throw new Error('No Google key: set GOOGLE_MAPS_API_KEY, or EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in mobile/.env');
    }

    // No fallback: a leg Google didn't return throws on lookup instead of being
    // quietly filled in.
    const t = await buildMatrix([MONASH_CLAYTON, BOX_HILL], { apiKey });

    for (const minutes of [t.minutes(MONASH_CLAYTON, BOX_HILL), t.minutes(BOX_HILL, MONASH_CLAYTON)]) {
      expect(minutes).toBeGreaterThan(5);
      expect(minutes).toBeLessThan(40);
    }
    // Routes leaves originIndex/destinationIndex out when they are 0, so for it
    // this leg only resolves if the client reads omitted indices as 0.
    expect(t.minutes(MONASH_CLAYTON, MONASH_CLAYTON)).toBeLessThan(1);
  }, 30_000);
});
