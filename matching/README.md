# Ribe matching (R5 / KEY-68)

Two halves. `src/` is pure TypeScript — no Firebase, no network, no database: the
algorithm takes arrays in and returns matches out, with travel time behind a
one-method interface. `runner/` is the thin layer that runs it for real: it reads
Firestore, builds Google travel times, calls `src/`, and writes the matches back.

```bash
npm install
npm test                          # 108 tests, offline
npm run test:live                 # the real Google APIs - billed, see "Testing"
npm run match -- --dry-run        # one run against Firestore, printed, nothing written
npm run match                     # one real run - see "Running it against Firestore"
npx ts-node test/simulate.ts      # SMART Goal 1 evidence run
```

## Files, and the tickets they close

| File | Tickets |
|---|---|
| `src/types.ts` | KEY-132 — request/offer structures, matching status, and a run's results (`ProposedMatch`, `MatchRunResult`) |
| `src/geo.ts` | KEY-135 — haversine, bearing, 0°/360° wraparound |
| `src/filter.ts` | KEY-133, 134, 136, 137 — time, direction, bearing, corridor, pair list |
| `src/route.ts` | KEY-138 — `addPassenger`: insertion positions and incremental feasibility, including David's pickup time-window check |
| `src/score.ts` | KEY-139 — `offerScore` / `reqScore`, via David's `calcDriverScore` / `calcPassengerScore`, including his slack |
| `src/deferredAcceptance.ts` | KEY-41 — **the default matching loop**: provisional assignment with bumping, one new rider per trip per run |
| `src/riderPolicy.ts` | derives a rider's `maxDetour` — the app never asks for it |
| `src/travelTime.ts` | the seam where Google Maps plugs in — Distance Matrix client (the runner's default) and the Routes API client that replaces it |
| `src/adapter.ts` | stored bookings → matcher inputs; batching by date + direction (the `batchKey`) |
| `src/melbourneTime.ts` | stored date + `"HH:mm"` → real instants, daylight saving included |
| `src/writes.ts` | when a match may still be written, and how a matched request catches up with its offer (expiry, offer removed) — no SDK, so testable |
| `runner/` | one matching run against Firestore (`npm run match`) |

## The algorithm, in one paragraph

**Provisional assignment with bumping** — `runMatchingProvisional` in
`src/deferredAcceptance.ts`. Riders propose to trips one at a time; a trip
holding a rider hasn't committed to them, and if a cheaper insertion comes along
later it drops the current holder back into the pool to try its next trip. It
replaced a one-shot greedy matcher (place a rider, never revisit), since
removed — see "Why bumping" below for the case greedy gets wrong.

**One new rider per trip, per run.** Accepting a match is a human decision, so a
driver is only ever offered a single new, unconfirmed rider per run however many
seats sit empty. Riders confirmed in an earlier run are fixed inputs: they stay,
are never bumped, and don't consume the slot. A 4-seat car therefore fills one
passenger at a time, across as many runs as it takes.

That rule is what makes a candidate's cost stable, and it is the reason the
algorithm no longer searches over subsets of riders. Because no two unconfirmed
riders ever share a route within a run, every candidate is measured against the
trip's fixed baseline and nothing else — so a placement can be computed once per
(rider, trip) pair and can never be invalidated by what happens to some other
rider later in the run. Under the previous model, where several new riders could
share one route, a rider's cost depended on who else happened to be aboard, which
is exactly why it needed a search over combinations and pickup orderings. The
practical consequence: a **precomputed score list is now correct**, not merely
convenient, which is what the scoring handoff assumes.

## Why not Gale–Shapley

Ribe drivers do not rank riders. They don't even approve them: only the rider
accepts or declines a match, and a driver's only move is to **close** (set how
many seats they'll take, or remove the trip altogether). They never say "I prefer rider A over rider B" — there is no
driver-side preference list for Gale-Shapley to resolve.

That matters for stability, not just naming: a blocking pair requires **both**
parties to strictly prefer each other over their current match. With drivers
indifferent by construction, no driver ever strictly prefers one rider to
another, so no blocking pair can exist — every feasible assignment is trivially
stable. The guarantee is vacuous, not hard-won.

What survives from deferred acceptance is the **mechanism**, not the theory:
provisional holds and bumping, used here as a search heuristic that avoids the
trap one-shot greedy falls into (below), not as two-sided preference resolution. Do not
call this Gale-Shapley in code, comments, or the report — call it provisional
assignment, deferred assignment, or greedy with backtracking.

`offerScore` is affected by this too. It used to read as "driver preference" —
it no longer is one. Reinterpret it as the **cost of this insertion to the
trip**: mostly marginal driving minutes, plus how much arrival slack the car
loses (David's slack idea — see "How pairs are scored" below). There is no
soft preference layered on top of it — gender and luggage were removed earlier
as hard gates, and quiet-ride affinity was removed because it never influenced
which rider a trip kept.

## How pairs are scored

`src/score.ts`, structured and named after David's scoring
(`backend/server/scoring.ts`): `calcDriverScore` and `calcPassengerScore`, each
a weighted blend of [0, 1] sub-scores.

```
offerScore = 0.8 x driving time   how little of the driver's remaining detour this rider uses
           + 0.2 x slack          share of the car's arrival slack left afterwards

reqScore   = 0.6 x detour         how little of their own detour cap the rider uses
           + 0.2 x punctuality    spare minutes before their own arrival time (full at 30)
           + 0.2 x slack
```

**Slack** is David's contribution: minutes to spare before the *tightest*
deadline anyone in the car has (the driver's included), after adding the rider,
as a share of what it was before. Two riders can cost the driver the same
minutes while one of them has to be on campus 30 seconds after the car arrives;
slack is what tells them apart. The driving-time score was already this
module's `offerScore` — David's formula for it is the same quantity. The
rider's detour term is ours, kept because SMART Goal 1 is measured in detour.
Driver weights are David's (0.8 / 0.2); the rider split is a judgement call.

**Where each score is used.** `reqScore` decides which driver a rider asks
first. `offerScore` is reported with every match — but the keep-or-bump choice
compares **raw marginal minutes**, not `offerScore`. Letting slack decide bumps was tried and
measurably strands riders: it penalises a tight deadline, and a rider with a
tight deadline is exactly the one with the fewest alternatives. In the worked
example below, a slack-aware D1 keeps A over B (B costs half a minute but
leaves the car 30 seconds of slack), and B — who can reach no other trip — is
left unmatched: two matches become one.

## Why bumping

Worked example (see `test/deferredAcceptance.test.ts` for the runnable version,
with exact numbers): riders A and B, drivers D1 and D2 with one seat each. B can
only reach D1; A can reach both, and D1 is also A's own best option. One-shot
greedy — the matcher this replaced — sorts by combined score and takes the
globally highest pair first — (A, D1) — locking D1 before B is ever considered.
B has nowhere else to go: **one match**. Provisional assignment lets A propose
to D1 first too, but when B proposes afterwards, D1 re-evaluates its best
feasible occupant and finds B strictly cheaper (a smaller marginal detour) —
so it bumps A back to the pool, where A lands on D2 on its next try:
**two matches**.

The mechanism, precisely: each unmatched rider proposes to whichever untried
compatible trip scores best for **them** (`reqScore`, judged against the trip's
confirmed baseline, never against whoever is currently just holding the
provisional slot). The proposer is then placed on that trip's fixed baseline via
`addPassenger` — which re-checks every confirmed rider's own detour cap,
arrival time and pickup window at each candidate position, so a newcomer can
never degrade someone a human already accepted. The trip's single slot then goes to whichever of
(current holder, new proposer) costs the driver fewer marginal minutes; a tie
keeps the holder, which avoids churn and keeps the run deterministic. The loser
returns to the pool and tries its next untried trip. It terminates because each
(rider, trip) pair is inspected at most once. Confirmed riders — anyone already
aboard when the run started — are fixed: always included, never bumped, and they
do not occupy the slot.

Note what this is *not*: a search over subsets of riders. That is what the
previous model needed, because a rider's cost there depended on which other new
riders shared the route. The comparison is now strictly two-way, which is why
`bestFeasibleSubset` and its combination/permutation generators are gone.

## Where a rider's detour cap comes from

The booking form asks riders only for date, earliest departure and latest
arrival — **not** for a detour tolerance. `MatchRequest.maxDetour` is still
required, so `src/riderPolicy.ts` derives it as **40% of the rider's own direct
trip, floored at 5 minutes** (`riderDetourPercent` / `riderDetourFloorMinutes`
in `MatchingConfig`).

A flat cap was rejected because it is blind to trip length: 15 minutes is a
150% detour on a 10-minute trip but 25% on an hour-long one, and Goal 1 is
stated as a percentage. Measured over 6 seeds, 100 riders / 30 drivers, scoring
matches against simulated true tolerances of 8–20 min the algorithm never saw
(`wouldDecline` = matched riders whose real tolerance was exceeded):

| declared cap | matched | wouldDecline | netConfirmed | vs direct |
|---|---|---|---|---|
| ask the rider | 70.5 | 0.0 | 70.5 | 19.0% |
| flat 15 min | 76.5 | 8.0 | 68.5 | 23.6% |
| flat 20 min | 80.5 | 10.5 | 70.0 | 25.4% |
| 35% of direct | 65.8 | 1.2 | 64.7 | 11.2% |
| **40% of direct** | **71.2** | **2.5** | **68.7** | **14.4%** |
| 50% of direct | 74.2 | 4.3 | 69.8 | 16.6% |
| 60% of direct | 76.8 | 7.8 | 69.0 | 20.1% |

40% is the largest share still under the 15% ceiling. Net confirmed matches are
statistically tied with asking the rider (68.7 vs 70.5, inside seed variance),
so the form field bought accuracy too small to measure at the cost of a
question every rider had to answer.

Note that raw `matched` is **not** the number to maximise here — a looser cap
always raises it, because the extra matches are ones riders would reject, and a
rejected match holds its seat for the whole approval window. Report
`netConfirmed` and `vs direct` together.

The caveat: this assumes rider tolerances genuinely vary (modelled 8–20 min,
matching `simulate.ts`). If real riders cluster tightly, a constant would do
just as well and this is over-engineering. That needs real users to settle.

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

**Leaving campus, a rider's detour is `waiting` alone.** Everyone boards at
campus and the waypoint is where the rider gets out, so the legs after it are
the driver's business, not theirs. Their `arriveBy` is checked at their own
drop-off too, not when the driver reaches home (`RouteEvaluation.riderArrivals`),
and the same arrival feeds their punctuality and slack scores.

## Simulation results (seed 20260917)

`npx ts-node test/simulate.ts` runs the matcher the way the app uses it: the
same batch is run repeatedly, with **every** match accepted in between, until a
run offers nobody new (3-4 runs here). Accepting everything is the best case -
real riders sometimes decline or don't answer, and an unanswered match holds its
seat until its deadline. Each rider's detour is measured on their car's **final** route, since
every later pickup can lengthen the detour of riders already aboard.

Supply sweep, 100 riders:

| Drivers | Seats | Matched | Match rate | Seat utilisation | Avg detour vs direct |
|---|---|---|---|---|---|
| 30 | 90 | 67 | 67% | 74% | 14.5% |
| 40 | 119 | 77 | **77%** | 65% | 12.1% |
| 50 | 149 | 86 | 86% | 58% | 9.8% |
| 60 | 180 | 90 | 90% | 50% | 10.4% |

This sweep runs with `useBearingFilter: false` on purpose, to isolate the
supply finding from the bearing filter's own effect (measured separately below).

These replace earlier figures (68 / 79 / 89 / 95 matched, about 1% detour). Those
came from the one-shot greedy matcher, which the app never ran, and took each
rider's detour at the moment they were added - before later pickups lengthened it.

**The 80% target needs more than 40 drivers per 100 riders** - roughly one
driver per 2-2.5 riders. Match rate tracks driver supply far more than anything
in the algorithm: that is a finding about the service, and it belongs in the
report - the match-rate goal is partly a driver-recruitment goal.

At 40 drivers with the default bearing filter (90°) on: **77% matched, 12.1%
average detour** - under the 15% detour ceiling, short of the 80% match target.

## The bearing filter (KEY-135/136)

Implemented as specced, and configurable so its cost is measurable rather than
assumed. At 40 drivers, off, 45° and 90° all give 77% here — the corridor test
is already removing the pairs bearing would have caught.

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

Confirming a match does **not** close a trip. `runMatchingProvisional` is a
pure function with no scheduler of its own, but the way it's meant to be called
repeatedly matters: after both parties accept, the trip re-enters the
pool as an input to the *next* run, still looking for more riders, via
`offer.onBoard` — carried forward as **fixed, immovable** inputs (see "Why
bumping" above). A 4-seat trip with 2 confirmed riders goes back into
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
already-open, under-full trip more chances to fill before its cutoff. The
`batchKey` is derived by `src/adapter.ts`; how often to run is still up to
whatever schedules `npm run match`.

## Running it against Firestore

`npm run match` does one pass (`runner/runOnce.ts`):

1. **Settle** every matched request against its offer (`planSettle`). A match
   whose `acceptDeadline` has passed expires: the request becomes `expired`
   (RideCard already tells the rider the trip is cancelled when the countdown
   ends) and the driver's slot is freed. A rider whose driver removed the offer
   — awaiting or already confirmed — goes back to `pending` with the match
   cleared; the driver's phone can't write the rider's booking, so the runner
   does. Both happen before matching, so everyone freed can be matched again in
   the same run.
2. **Read** every request and offer whose stored status is `pending` (the app's
   word for "not matched yet" — see `mobile/pages/schema/matchStatus.ts`).
3. **Batch** them by Melbourne date and direction, e.g. `2026-10-05_TO_CAMPUS`.
   Both come from fields that never change after submission, so the key is stable
   without being stored. Bookings with no coordinates, a malformed time, a trip
   already under way, or a driver still waiting on a rider are left out and
   counted in the output.
4. **Per batch:** build one travel-time matrix, convert, run
   `runMatchingProvisional` with each driver routed from their **own** departure
   time, and write each match in its own transaction.

```bash
npm run match -- --dry-run      # compute and print; write nothing, expire nothing
npm run match -- --synthetic    # estimated travel times, no Google calls
npm run match -- --routes       # Routes API instead of Distance Matrix
```

Every rider a run leaves unmatched is listed with each driver's reason, in
words — "too far off the driver's route", "would push someone already in the
car past their detour limit", "fits, but the driver's one new seat this run went
to a rider who adds fewer minutes", and so on. The reasons
(`MatchRunResult.unmatchedReasons`) are worked out after the run, against the
same baselines the run used, so they explain the result without changing it.

**Configuration** — environment variables, falling back to `mobile/.env` for the
two values the app already has:

| Variable | |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | path to a service-account key (Firebase console → Project settings → Service accounts → Generate new private key). **Keep it outside the repo** — it bypasses every security rule. `GOOGLE_APPLICATION_CREDENTIALS` works too. |
| `FIREBASE_PROJECT_ID` | falls back to `EXPO_PUBLIC_FIREBASE_PROJECT_ID` |
| `GOOGLE_MAPS_API_KEY` | falls back to `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`; the key's project needs the **Distance Matrix API** enabled, or the Routes API with `--routes`. Without a key, travel times are synthetic estimates and the run says so. |
| `FIRESTORE_EMULATOR_HOST` | run against the local emulator; no credentials needed |

**Scheduling** is deliberately outside the code. Anything that can run a command
on a timer works — cron, Windows Task Scheduler, a CI schedule. Since each run
offers a driver one new rider, running more often is what fills a 4-seat car
before its cutoff.

### What the runner writes, and why

- **A match** (`src/writes.ts` → `planMatchWrite`): request → `awaiting` with
  `matchedOfferId`, `matchedDriverId`, `matchedAt`, `acceptDeadline`,
  `riderDetourMinutes`, `routeIndex`, `pickupAt` and `arriveAt`; offer →
  `awaiting` with `pendingRequestId`, `matchedRiderId` (what lets the rider's
  phone update the driver's offer under the Firestore rules) and
  `pendingSchedule`. Re-checked inside the transaction, because the run works
  from a snapshot: the rider may have cancelled, the driver's slot may have been
  filled, or — `BASELINE_CHANGED` — the driver's confirmed riders may no longer
  be the ones the route was computed for. Any of those skips the write.
- **Pickup order.** `routeIndex` is where the rider sits among the driver's
  confirmed riders. `acceptMatch` (in the app) inserts them there, so
  `confirmedRequestIds` is always in pickup order. The next run rebuilds the
  car's route from that list, so an append-only list would silently re-check
  everyone's detour against the wrong route.
- **The car's timetable.** `schedule` on the offer is the driver's departure and
  arrival plus every confirmed rider's estimated pickup and arrival, in pickup
  order; it's what the ride cards show instead of the booking window. Picking up
  a new rider can move everyone else's times (never past their detour cap or
  arrival deadline), so each match proposes a whole new timetable as
  `pendingSchedule`, and `acceptMatch` moves it into `schedule`. It's stored on
  the offer rather than on each request because a rider's phone can't update
  another rider's booking. The request's own `pickupAt`/`arriveAt` are a
  snapshot from match time, used only if the offer can't be read.
- **Locking and seats.** A driver can lock their drive (`acceptingMore: false`
  on the offer) or change `seatCapacity` from their ride card. A locked offer
  is skipped (`LOCKED`) and never written to, and once anyone is aboard it is
  done (`confirmed`) even with seats free; unlocking puts it back in the pool.
  Every place that frees a pending slot - accept, decline, expiry - works out
  the offer's status the same way (`settledOfferStatus`, in `writes.ts` and
  the app), so a locked car can't quietly reopen. A rider already deciding on a
  match keeps their seat through a lock, and seats never drop below the
  riders aboard plus that one.
- **Arrival margin.** Riders and drivers are planned to arrive
  `arrivalMarginMinutes` (10) before the time they gave, because drive times
  don't include traffic. The adapter applies it; a match that only works
  without the margin isn't made.
- **Trips to campus are planned from the deadline.** A booking's departure
  time is the *earliest* that person can leave, not when they want to. A driver
  and rider who both said "7:00-9:00" used to be timed from 7:00 - pickup 7:15,
  on campus at 7:30, an hour and a half early. Now the matcher checks the route
  leaving at the earliest (anyone late even then is a no), then slides the whole
  trip as late as the tightest deadline in the car allows (`slideMinutes` in
  `route.ts`): leave ~8:20, pickup ~8:35, on campus 8:50. Sliding is a pure time
  shift, so detours, pickup order and bumping are unchanged, and scores stay
  measured from the earliest departure (otherwise slack would read zero for
  every trip). It also matches more people: a rider who isn't ready until
  8:15 could never be collected by a driver timed from 7:00, but can once the
  trip is timed from 8:50 - "picked up before they're ready" is checked at the
  slid times. Trips **from** campus don't slide: "leave from 5pm" means take me
  home when class ends, so they keep the earliest departure.

### Travel times: Distance Matrix by default, Routes ready

The runner uses **Distance Matrix** (`buildGoogleTravelTimeMatrix`) by default,
because it is the API Ribe's Maps key has enabled — `npm run test:live` calls
both, and on 1 October 2026 Distance Matrix passed while Routes was refused
("Routes API has not been used in project … or it is disabled").

Distance Matrix is a legacy service: Google froze it on 1 March 2025, Cloud
projects created since cannot enable it, and it will be turned down with 12
months' notice. Projects that used it before keep it. Its replacement is ready
behind the same `PrecomputedTravelTime` interface: `buildRoutesTravelTimeMatrix`
(`computeRouteMatrix`), selected with `npm run match -- --routes` once the key's
project enables the Routes API. Switching is a flag, not a code change.

Both clients dedupe points (campus appears constantly), send 10×10 chunks
(under every element cap), and leave out unroutable legs, which fall back to
`SyntheticTravelTime` in the runner. No API calls happen inside the matching
loop. Neither uses live traffic: a batch spans a whole day of departures, so no
single departure time describes every leg, and traffic "now" is wrong for
tomorrow morning. **Cost grows with the square of a batch's distinct points**,
which is why the matrix is built per batch rather than across days.

## Testing

### Automated suite

`npm test` runs Jest through `ts-jest` (see `jest.config.js`: `testMatch: ['**/test/**/*.test.ts']`,
no separate build step — TypeScript is compiled in-memory per test run). Each
source file has a companion test file that exercises it directly:

| Test file | Exercises |
|---|---|
| `test/geo.test.ts` | `haversineKm`, `bearingDegrees`, `bearingDifference` (KEY-135) — including the 350°/10° wraparound case |
| `test/filter.test.ts` | `windowsOverlap` (KEY-133), `corridorDetourKm`, and `hardFilter`'s reject-reason ordering (KEY-137) |
| `test/route.test.ts` | `evaluateRoute`'s waiting+riding detour math (the "last rider scores zero" bug), each rider's own arrival and detour leaving campus, and `addPassenger`'s re-check of every existing rider and its pickup time-window check (KEY-138) |
| `test/deferredAcceptance.test.ts` | `runMatchingProvisional` end to end — the worked bumping example, confirmed riders never being bumped, one new rider per trip per run, capacity, `acceptDeadline` clamping and the matching cutoff |
| `test/travelTime.test.ts` | both Google clients (Routes and legacy Distance Matrix) against a fake `fetch` — batching, dedup, request shape, and fallback on failed legs. `SyntheticTravelTime` has no tests of its own |
| `test/melbourneTime.test.ts` | stored local-midnight dates and `"HH:mm"` times across the daylight-saving change |
| `test/adapter.test.ts` | batching, every skip reason, rider/driver windows and detour caps, confirmed riders rebuilt in pickup order |
| `test/writes.test.ts` | every reason a match write is refused; expiry, and riders returned when a driver removes the offer |
| `test/score.test.ts` | each sub-score, the 0.8 / 0.2 driver blend, and slack telling apart two riders who cost the same minutes |
| `test/runOnce.test.ts` | the whole run against an in-memory store: match → wait → accept → fill the next seat in pickup order; a removed offer returning its riders; expiry freeing a driver; dry run; one failing batch |

`npm run test:live` runs `test/travelTime.live.test.ts` instead: one small real
request to each Google API (2×2 matrix, campus to Box Hill), to check the fakes
above still match what Google sends. It needs the key from `mobile/.env`, is
billed (well inside the free tier), and is kept out of `npm test` by
`jest.config.js`. One API passing while the other fails says which one the key's
project has enabled.

The runner's Firestore layer (`runner/firestore.ts`) is the one piece these tests
don't reach: it is a thin transaction wrapper around the `src/writes.ts` rules,
which are tested. Try it first with `npm run match -- --dry-run`.

The app's side of the round trip — `acceptMatch` / `declineMatch` / `cancelOffer` — is covered by
`tests/integration/matchResponse.test.ts` in the app's own suite.

`test/fixtures.ts` is not a test file itself. It holds shared builders
(`makeRequest`, `makeOffer`, `ring`, `at`, `CAMPUS`) that every test file
imports, so scenarios are built the same way everywhere and date handling
(`at()` assumes Melbourne, UTC+10) lives in one place instead of being
re-derived per test.

### Manual testing

Two ways to poke at the algorithm without writing a Jest test:

1. **The simulate.ts evidence run** — `npx ts-node test/simulate.ts` builds a
   batch of synthetic riders/drivers on a fixed seed, runs
   `runMatchingProvisional` repeatedly until it settles, and prints match rate
   and detour stats. Good for eyeballing the effect of a config or weight change
   at realistic batch size, but it reports aggregates, not individual pairings.

2. **A throwaway `ts-node` script for one scenario** — import the module and
   the test fixtures directly to inspect a single pair or a handful of riders:

   ```ts
   // scratch.ts — not committed, just for a one-off check
   import { runMatchingProvisional } from './src/deferredAcceptance';
   import { SyntheticTravelTime } from './src/travelTime';
   import { DEFAULT_CONFIG } from './src/types';
   import { makeRequest, makeOffer, at, CAMPUS } from './test/fixtures';

   const req = makeRequest({ reqId: 'r1', start: { lat: CAMPUS.lat + 0.05, lon: CAMPUS.lon } });
   const offer = makeOffer({ offerId: 'o1', start: { lat: CAMPUS.lat + 0.1, lon: CAMPUS.lon } });

   const result = runMatchingProvisional(
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

- **A single run cannot exceed one match per driver.** That is the rule working
  as intended, not a defect, but it means the 80% Goal 1 target depends on run
  frequency before departure, which nothing in this module controls.
- Provisional assignment is a heuristic, not an exhaustive search: a trip
  found infeasible for a rider (or a rider it's already tried) is crossed off
  for that rider for the rest of the run, even though it could in principle
  loosen up later if the trip bumps its holder first. This bounds runtime
  and gives the algorithm's termination argument, at the cost of occasionally
  missing an arrangement an exhaustive search would find.
- Within a trip, fixed (confirmed) riders keep their original relative pickup
  order; only where the one new rider slots in among them is searched.
  Reordering confirmed riders relative to each other is deliberately out of
  scope, since nothing about correctness requires reopening a route a human
  already accepted.
- Insertion search (`addPassenger`) is exhaustive
  over positions. Fine to ~6 seats; beyond that it needs a heuristic.
- `SyntheticTravelTime` noise is one-sided (legs only ever get slower). Two-sided
  noise lets a detour come out faster than the direct route, which is
  geometrically impossible and produces negative detours in the statistics.
- **The car never waits at a door.** `addPassenger` refuses any position where
  the car would reach a rider before their stated departure time (David's
  time-window scan). A real driver could simply wait a few minutes, but waiting
  delays everyone already aboard and the detour maths doesn't count idle time,
  so an early arrival is treated as infeasible rather than under-reporting
  detour. This costs some matches where the driver lives further out and leaves
  early.
- Only the rider can accept. Driver-side approval, cancelling a confirmed ride,
  and `firestore.rules` do not exist yet.
