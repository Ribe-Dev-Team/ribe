# Ribe matching (R5 / KEY-68)

Pure TypeScript. No Firebase, no Google Maps, no database — the algorithm takes
arrays in and returns matches out. The only external dependency is travel time,
behind a one-method interface you swap for the real Distance Matrix later.

```bash
npm install
npm test                    # 35 tests
npx ts-node test/simulate.ts # SMART Goal 1 evidence run
```

## Files, and the tickets they close

| File | Tickets |
|---|---|
| `src/types.ts` | KEY-132 — request/offer structures and matching status |
| `src/geo.ts` | KEY-135 — haversine, bearing, 0°/360° wraparound |
| `src/filter.ts` | KEY-133, 134, 136, 137 — time, direction, bearing, corridor, pair list |
| `src/route.ts` | KEY-138 — insertion positions and incremental feasibility |
| `src/score.ts` | KEY-139 — `offerScore` / `reqScore` |
| `src/match.ts` | KEY-41 — the matching loop |
| `src/travelTime.ts` | the seam where Google Maps plugs in |

## The algorithm, in one paragraph

Sequential greedy assignment with incremental feasibility. Riders are placed one
at a time; after each placement the affected trip is re-evaluated, because adding
a rider changes the detour experienced by **everyone already aboard**. A trip
stops accepting riders when it is full, when the driver closes it, when the
tightest rider's remaining slack runs out, or at the matching cutoff.

## Why not Gale–Shapley

We evaluated deferred acceptance (the Hospital/Residents variant, since drivers
have capacity) and rejected it for two reasons.

Its stability guarantee assumes every party accepts their assignment. Ribe's
drivers can decline — `rideMatch.status` has `driver_cancelled` and
`driver_expired` precisely because they can — and the moment one does, the
guarantee is void and the batch must be recomputed.

More fundamentally, deferred acceptance requires **fixed** preference lists.
Ridesharing preferences are route-dependent: once a driver collects rider A, the
cost of rider B changes. Two riders on the same street also cost barely more
together than one, which is a complementarity, and complementarities break the
substitutability condition the stability proof relies on — with them, a stable
matching need not exist at all.

So we claim **feasibility**, not stability, and we handle rejection natively.

The tradeoff is real and worth stating: greedy can lock an early pair that blocks
a better global arrangement. `test/simulate.ts` is where you measure that cost.

## What a rider's "detour" means

Two components, and using only the second is a trap we hit and fixed:

```
detour(i) = waiting + riding

waiting = (time the car actually reaches them)
        − (time it could have reached them going straight from the driver's origin)

riding  = (time from their pickup to campus along the shared route)
        − (time from their pickup to campus direct)
```

With `riding` alone, the **last** person collected always scores exactly zero,
because their final leg is by definition the direct leg. That silently makes
"add one more rider at the end" look free. See `test/route.test.ts`.

## Simulation results (seed 20260917)

Supply sweep, 100 riders:

| Drivers | Seats | Matched | Match rate | Seat utilisation |
|---|---|---|---|---|
| 30 | 90 | 70 | 70% | 78% |
| 40 | 119 | 80 | **80%** | 67% |
| 50 | 149 | 89 | 89% | 60% |
| 60 | 180 | 94 | 94% | 52% |

This sweep runs with `useBearingFilter: false` on purpose, to isolate the
supply-cap finding from the bearing filter's own effect (measured separately
below) — so these numbers are the algorithm's floor, before that filter even
runs.

**The 80% target needs roughly one driver per 2.5 riders.** At 30 drivers the
batch is supply-capped at 70% no matter how good the matching is. That is a
finding about the service, not the algorithm, and it belongs in the report —
your match-rate goal is partly a driver-recruitment goal.

At 40 drivers with the default bearing filter (90°) on: **81% matched, 0.9%
average detour** against a <15% target — see the next section.

## The bearing filter (KEY-135/136)

Implemented as specced, and configurable so its cost is measurable rather than
assumed. At 40 drivers, 45° and 90° both give 81% here — the corridor test is
already removing the pairs bearing would have caught.

Be aware the threshold has no fixed physical meaning. For two points at distance
*r* from campus with bearing difference θ, their separation is `2r·sin(θ/2)`, so
a 45° gate permits 0.77 km of separation 1 km out but 15.3 km at 20 km out —
strict where pickups are easy, loose where they are hard.

It is also applied **only when the driver has nobody aboard yet**. A bearing
describes one segment; once there is a waypoint the route is multi-segment and no
single bearing describes it. That is exactly the situation KEY-138 creates, and
it is why `bearingCompatible` returns early when `onBoard.length > 0`.

## Matching cutoff and accept deadline

A trip stops accepting new riders once departure is within
`cfg.matchingCutoffMinutes` (default 120) — independent of seats or slack, so
even a nearly-empty trip locks on schedule. Anchored to **departure**, not
arrival: arrival is what a rider states, departure is when the car actually
leaves and someone has to be standing outside, and it's what `travelWindow`
already keys off.

This is distinct from the mobile app's own submission cutoff (KEY-90 — how
close to departure a request/offer can even be *created*). That's an app-layer
concern; this module only governs when a batch stops *matching*, and the two
numbers don't have to match. If submission stays open right up to departure,
matching cutoff is the only thing giving a request meaningful time in the pool.

Every match also gets an `acceptDeadline`:

```ts
acceptDeadline = min(matchedAt + approvalWindowMinutes, departAt − matchingCutoffMinutes)
```

`approvalWindowMinutes` (default 720 = 12h) mirrors the mobile app's
`APPROVAL_WINDOW_MS` (`RideCard.tsx`). Without the clamp, a match proposed late
in a batch could promise up to 12 hours to accept even though the trip locks
in 2 — the UI would show a countdown the system can't honour. In practice, for
any batch running less than ~14 hours before departure, the cutoff term is the
one that binds.

## Wiring Firebase later

Two adapters, roughly forty lines, and nothing in `src/` changes:

```ts
// read
const requests = await db.collection('rideRequests')
  .where('batchKey', '==', key).where('status', '==', 'unassigned').get();

// match — unchanged, pure
const result = runMatching(key, requests, offers, departAt, new Date(), distanceMatrix);

// write: one transaction per match, decrementing seatsAvailable inside it
```

`buildGoogleTravelTimeMatrix` in `src/travelTime.ts` is that client. Call it once
per batch with every coordinate the run could query — each offer's `start`/`end`
and every request's `waypointOf(req)` — and it returns a `PrecomputedTravelTime`
implementing `minutes(a, b)` purely from an in-memory table:

```ts
const points = [
  ...offers.flatMap((o) => [o.start, o.end]),
  ...requests.map(waypointOf),
];
const t = await buildGoogleTravelTimeMatrix(points, {
  apiKey: process.env.GOOGLE_MAPS_API_KEY!,
  fallback: new SyntheticTravelTime(), // optional: covers legs Google can't route
});

const result = runMatching(key, requests, offers, departAt, new Date(), t);
```

It batches into `chunkSize x chunkSize` requests (default 10x10) to stay under
Google's per-request element cap, dedupes repeated points first (campus shows up
constantly), and leaves out legs Google returns a non-OK status for — those fall
back to `fallback` if given, or throw lazily on lookup, only if the matching run
actually needed that leg. No API calls happen inside the matching loop itself.

## Known limitations

- Greedy, so no global optimality guarantee. Measurable via `simulate.ts`.
- Insertion search is exhaustive over positions. Fine to ~6 seats; beyond that
  it needs a heuristic.
- `SyntheticTravelTime` noise is one-sided (legs only ever get slower). Two-sided
  noise lets a detour come out faster than the direct route, which is
  geometrically impossible and produces negative detours in the statistics.
