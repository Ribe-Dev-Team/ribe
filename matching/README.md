# Ribe matching (R5 / KEY-68)

Pure TypeScript. No Firebase, no Google Maps, no database — the algorithm takes
arrays in and returns matches out. The only external dependency is travel time,
behind a one-method interface you swap for the real Distance Matrix later.

```bash
npm install
npm test                    # 39 tests
npx ts-node test/simulate.ts # SMART Goal 1 evidence run
npx ts-node test/compare.ts  # greedy vs provisional bumping, side by side
```

## Files, and the tickets they close

| File | Tickets |
|---|---|
| `src/types.ts` | KEY-132 — request/offer structures and matching status |
| `src/geo.ts` | KEY-135 — haversine, bearing, 0°/360° wraparound |
| `src/filter.ts` | KEY-133, 134, 136, 137 — time, direction, bearing, corridor, pair list |
| `src/route.ts` | KEY-138 — insertion positions and incremental feasibility |
| `src/score.ts` | KEY-139 — `offerScore` / `reqScore` |
| `src/deferredAcceptance.ts` | KEY-41 — **the default matching loop**: provisional assignment with bumping |
| `src/match.ts` | KEY-41 — one-shot greedy, kept as the comparison baseline |
| `src/travelTime.ts` | the seam where Google Maps plugs in |

## The algorithm, in one paragraph

**Provisional assignment with bumping**, not one-shot greedy — `runMatchingProvisional`
in `src/deferredAcceptance.ts` is the default path. Riders propose to trips one at
a time; a trip holding a rider hasn't committed to them, and if a cheaper insertion
comes along later it drops the current holder back into the pool to try its next
trip. `src/match.ts`'s one-shot greedy (place a rider, never revisit) is kept
specifically as the comparison baseline — see "Why bumping, measured" below for
why it isn't the default anymore.

## Why not Gale–Shapley

Ribe drivers do not rank riders. Once matched, they only ever **veto** (accept or
decline what they're given) or **close** (set how many seats they'll take, or stop
looking early). They never say "I prefer rider A over rider B" — there is no
driver-side preference list for Gale-Shapley to resolve.

That matters for stability, not just naming: a blocking pair requires **both**
parties to strictly prefer each other over their current match. With drivers
indifferent by construction, no driver ever strictly prefers one rider to
another, so no blocking pair can exist — every feasible assignment is trivially
stable. The guarantee is vacuous, not hard-won.

What survives from deferred acceptance is the **mechanism**, not the theory:
provisional holds and bumping, used here as a search heuristic that measurably
beats one-shot greedy (below), not as two-sided preference resolution. Do not
call this Gale-Shapley in code, comments, or the report — call it provisional
assignment, deferred assignment, or greedy with backtracking.

`offerScore` is affected by this too. It used to read as "driver preference" —
it no longer is one. Reinterpret it as the **marginal cost of this insertion**:
still worth tracking, because cheap insertions preserve capacity for later
riders, which is exactly the lever bumping pulls on to raise match rate. There
is also no soft preference layered on top of it any more — gender and luggage
were removed earlier as hard gates, and quiet-ride affinity has been removed
too, since it never actually influenced which rider a trip kept (the bump
decision compares raw marginal minutes) and was cosmetic at best.

## Why bumping, measured

Both algorithms run on identical batches, same seed, via `test/compare.ts`:

```
nReq nOff | greedy matched/rate/detour     | provisional matched/rate/detour
  60   25 |  42    70%   0.45m            |  47    78%   3.27m
 100   40 |  81    81%   0.27m            |  83    83%   3.41m
 100   30 |  67    67%   0.16m            |  68    68%   3.31m
  80   35 |  66    83%   0.22m            |  65    81%   3.17m
 120   50 | 102    85%   0.25m            | 109    91%   3.45m
```

Bumping wins match rate in most cases (up to +8 points) at the cost of roughly
10x higher average rider detour — and it is not a strict win: at 80 requests /
35 offers this particular seed comes out one match *behind* greedy, a reminder
that this is a heuristic with no optimality guarantee in either direction. As a
percentage of each rider's own direct trip, provisional's detour runs
13.8%–15.6% against the <15% Goal 1 ceiling — comfortably under in most rows,
but over it in one (100 requests / 30 offers). Report both numbers; this is a
real trade, not a free win, and the ceiling is worth watching rather than
assuming.

Why bumping wins, worked example (see `test/deferredAcceptance.test.ts` for
the runnable version, with exact numbers): riders A and B, drivers D1 and D2
with one seat each. B can only reach D1; A can reach both, and D1 is also A's
own best option. One-shot greedy sorts by combined score and takes the
globally highest pair first — (A, D1) — locking D1 before B is ever considered.
B has nowhere else to go: **one match**. Provisional assignment lets A propose
to D1 first too, but when B proposes afterwards, D1 re-evaluates its best
feasible occupant and finds B strictly cheaper (a smaller marginal detour) —
so it bumps A back to the pool, where A lands on D2 on its next try:
**two matches**.

The mechanism, precisely: each unmatched rider proposes to whichever untried
compatible trip scores best for **them** (`reqScore`, judged against the
trip's confirmed baseline, never against who else is currently just holding a
provisional spot). Each trip, on receiving a proposal, recomputes the best
feasible subset of (currently held riders + this new proposer) — size bounded
by seats, feasible meaning every rider's detour cap and arrival time still
hold — preferring the largest matched count, tie-broken by lowest total
marginal driver cost. Riders dropped return to the pool and try their next
untried trip. It terminates because each (rider, trip) pair is inspected at
most once. Confirmed riders — anyone already aboard when the run started — are
fixed: always included, never bumped, because a human already accepted that
trip.

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

## Trip lifecycle across runs

Confirming a match does **not** close a trip. `runMatching`/`runMatchingProvisional`
are pure functions with no scheduler of their own, but the way they're meant to
be called repeatedly matters: after both parties accept, the trip re-enters the
pool as an input to the *next* run, still looking for more riders, via
`offer.onBoard` — carried forward as **fixed, immovable** inputs (see "Why
bumping, measured" above). A 4-seat trip with 2 confirmed riders goes back into
the pool next run and can still pick up a 3rd and a 4th.

A trip stops being offered new riders for one of four reasons, corresponding
to `isAcceptingRiders` (route.ts) exactly:

```
full            seatsFilled >= seatsOffered
driver locked   !acceptingMore   — a live toggle the driver controls, separate
                                   from seatsFilled so match-rate stats can
                                   tell "driver chose to stop" apart from
                                   "ran out of seats"
out of slack    minSlack <= insertionFloorMinutes — capacity is bounded by
                                   consent, not just seats
past cutoff     departure inside cfg.matchingCutoffMinutes
```

`offer.status` stays `'open'` through confirmation — it only becomes `'closed'`
on the first two, `'locked'` on the last. This module doesn't decide *how often*
to run; that's a scheduling decision independent of the algorithm (any
frequency works with bumping), and running more often only gives an
already-open, under-full trip more chances to fill before its cutoff. No
scheduler, cutoff clock, or `batchKey` derivation lives in `src/` yet — that's
still a caller-side concern.

## Wiring Firebase later

Two adapters, roughly forty lines, and nothing in `src/` changes:

```ts
// read
const requests = await db.collection('rideRequests')
  .where('batchKey', '==', key).where('status', '==', 'unassigned').get();

// match — unchanged, pure
const result = runMatchingProvisional(key, requests, offers, departAt, new Date(), distanceMatrix);

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

const result = runMatchingProvisional(key, requests, offers, departAt, new Date(), t);
```

It batches into `chunkSize x chunkSize` requests (default 10x10) to stay under
Google's per-request element cap, dedupes repeated points first (campus shows up
constantly), and leaves out legs Google returns a non-OK status for — those fall
back to `fallback` if given, or throw lazily on lookup, only if the matching run
actually needed that leg. No API calls happen inside the matching loop itself.

## Testing

### Automated suite

`npm test` runs Jest through `ts-jest` (see `jest.config.js`: `testMatch: ['**/test/**/*.test.ts']`,
no separate build step — TypeScript is compiled in-memory per test run). Each
source file has a companion test file that exercises it directly:

| Test file | Exercises |
|---|---|
| `test/geo.test.ts` | `haversineKm`, `bearingDegrees`, `bearingDifference` (KEY-135) — including the 350°/10° wraparound case |
| `test/filter.test.ts` | `windowsOverlap` (KEY-133), `corridorDetourKm`, and `hardFilter`'s reject-reason ordering (KEY-137) |
| `test/route.test.ts` | `evaluateRoute`'s waiting+riding detour math (the "last rider scores zero" bug) and `bestInsertion`'s re-check of every existing rider (KEY-138) |
| `test/match.test.ts` | `runMatching` end to end — the greedy assignment loop, stats, `acceptDeadline` clamping |
| `test/deferredAcceptance.test.ts` | `runMatchingProvisional` end to end — the worked bumping example (greedy strands a rider, provisional relocates them), confirmed riders never being bumped, capacity/detour caps still holding |
| `test/travelTime.test.ts` | `SyntheticTravelTime` / the Google Distance Matrix client — batching, dedup, and fallback on failed legs |

`test/fixtures.ts` is not a test file itself. It holds shared builders
(`makeRequest`, `makeOffer`, `ring`, `at`, `CAMPUS`) that every test file
imports, so scenarios are built the same way everywhere and date handling
(`at()` assumes Melbourne, UTC+10) lives in one place instead of being
re-derived per test.

### Manual testing

Three ways to poke at the algorithm without writing a Jest test:

1. **The simulate.ts evidence run** — `npx ts-node test/simulate.ts` builds a
   batch of synthetic riders/drivers on a fixed seed, runs `runMatching`, and
   prints match rate and detour stats. Good for eyeballing the effect of a
   config or weight change at realistic batch size, but it reports aggregates,
   not individual pairings. (Still exercises the greedy baseline specifically —
   swap in `runMatchingProvisional` to see the default path's numbers instead.)

2. **The compare.ts head-to-head** — `npx ts-node test/compare.ts` runs both
   `runMatching` and `runMatchingProvisional` on the same batches and prints
   match rate and detour side by side. This is what produced the numbers in
   "Why bumping, measured" above — rerun it after any scoring or weight change
   to see whether the trade-off moved.

3. **A throwaway `ts-node` script for one scenario** — import the module and
   the test fixtures directly to inspect a single pair or a handful of riders:

   ```ts
   // scratch.ts — not committed, just for a one-off check
   import { runMatching } from './src/match';
   import { SyntheticTravelTime } from './src/travelTime';
   import { DEFAULT_CONFIG } from './src/types';
   import { makeRequest, makeOffer, at, CAMPUS } from './test/fixtures';

   const req = makeRequest({ reqId: 'r1', start: { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon } });
   const offer = makeOffer({ offerId: 'o1', start: { lat: CAMPUS.lat + 0.1, lon: CAMPUS.lon } });

   const result = runMatching(
     'test-batch', [req], [offer], at(8), at(0),
     new SyntheticTravelTime({ seed: 1 }), DEFAULT_CONFIG,
   );
   console.log(result.matches, result.rejected);
   ```

   ```bash
   npx ts-node scratch.ts
   ```

   Run it the same way `simulate.ts` is run. Delete the scratch file when
   done — it is not part of the suite, and `fixtures.ts` is under `test/`
   precisely so throwaway scripts and real tests can share the same builders.

## Known limitations

- Provisional assignment is a heuristic, not an exhaustive search: a trip
  found infeasible for a rider (or a rider it's already tried) is crossed off
  for that rider for the rest of the run, even though it could in principle
  loosen up later if the trip bumps someone else first. This bounds runtime
  and gives the algorithm's termination argument, at the cost of occasionally
  missing an arrangement an exhaustive search would find — see the "not a
  strict win" result in "Why bumping, measured" above.
- Within a trip, fixed (confirmed) riders keep their original relative pickup
  order; only where new riders slot in among them is searched. Full
  permutation search covers just the new riders being added in a given
  proposal (bounded by seats, so ≤ 24 orderings at 4 seats) — reordering
  confirmed riders relative to each other is deliberately out of scope, since
  nothing about correctness requires reopening a route a human already
  accepted.
- One-shot greedy (`src/match.ts`) is still around specifically as the
  comparison baseline, not because it's a viable alternative default — see
  "Why bumping, measured". Its own known limitation: no global optimality
  guarantee, since it never revisits an early placement.
- Insertion search (`bestInsertion`, used by both algorithms) is exhaustive
  over positions. Fine to ~6 seats; beyond that it needs a heuristic.
- `SyntheticTravelTime` noise is one-sided (legs only ever get slower). Two-sided
  noise lets a detour come out faster than the direct route, which is
  geometrically impossible and produces negative detours in the statistics.
