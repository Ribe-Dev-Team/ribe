/*
Runs one matching pass against Firestore. From matching/:

    npm run match                  write matches and expiries
    npm run match -- --dry-run     compute and print only, write nothing
    npm run match -- --synthetic   estimated travel times, no Google calls
    npm run match -- --routes      Routes API instead of Distance Matrix, once
                                   the key's project has the Routes API enabled

Configuration, from the environment, falling back to mobile/.env for the two
values the app already has:

    FIREBASE_SERVICE_ACCOUNT   path to a service-account JSON key (or set
                               GOOGLE_APPLICATION_CREDENTIALS instead)
    FIREBASE_PROJECT_ID        falls back to EXPO_PUBLIC_FIREBASE_PROJECT_ID
    GOOGLE_MAPS_API_KEY        falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
                               needs the Distance Matrix API enabled (or the
                               Routes API, with --routes). With no key, travel
                               times are synthetic estimates.

Distance Matrix is the default because it is the one Ribe's Maps key has
enabled (checked with `npm run test:live`). Google made it a legacy API in
March 2025: projects that already use it keep it, new projects cannot turn it
on. If the key ever moves to a newer project, switch to --routes.
    FIRESTORE_EMULATOR_HOST    run against the local emulator, no credentials

One run is one pass. How often to run it (every 15 minutes, hourly) is a
scheduling choice - cron, Task Scheduler or a CI schedule all work - and more
frequent runs fill cars faster, since each run offers a driver one new rider.
*/

import { SkipReason } from '../src/adapter';
import { RejectReason } from '../src/types';
import { CAMPUS_TIME_ZONE } from '../src/melbourneTime';
import {
  buildGoogleTravelTimeMatrix, buildRoutesTravelTimeMatrix, SyntheticTravelTime,
} from '../src/travelTime';
import { envValue } from './env';
import { connect, expireOverdue, loadPending, loadRequestsById, writeMatches } from './firestore';
import { MatchingStore, RunReport, runOnce } from './runOnce';

/** Why a driver didn't take a rider, in words. A Record so a new reason
 *  without wording fails the build instead of printing a code. */
const WHY: Record<RejectReason, string> = {
  SAME_PERSON: 'same person as the driver',
  OFFER_NOT_OPEN: 'not taking riders (full or closed)',
  NO_SEATS: 'no seats left',
  DRIVER_CLOSED: 'driver has stopped taking riders',
  OUT_OF_SLACK: 'someone already in the car has no detour to spare',
  DIRECTION: 'going the other way',
  TIME_WINDOW: "travel times don't overlap",
  BEARING: 'coming from a different direction',
  CORRIDOR: "too far off the driver's route",
  NO_FEASIBLE_INSERTION: 'no pickup position works',
  RIDER_DETOUR_CAP: "the detour would be too long for this rider",
  ONBOARD_DETOUR_CAP: 'would push someone already in the car past their detour limit',
  DRIVER_DETOUR_CAP: "would go over the driver's detour limit",
  ARRIVAL_WINDOW: 'someone would arrive too late',
  PICKUP_BEFORE_READY: 'the car would arrive before the rider is ready',
  MATCHING_CUTOFF: 'too close to departure to match',
  LOST_SLOT: "fits, but the driver's one new seat this run went to a rider who adds fewer minutes",
};

function printReport(report: RunReport, dryRun: boolean): void {
  if (report.expired.length) {
    console.log(`Expired ${report.expired.length} match(es) past their accept deadline: ${report.expired.join(', ')}`);
  }

  if (report.skipped.length) {
    const counts = new Map<SkipReason, number>();
    for (const s of report.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
    console.log(`Left out ${report.skipped.length} booking(s): ${[...counts].map(([r, n]) => `${r} x${n}`).join(', ')}`);
  }

  if (report.batches.length === 0) console.log('Nothing to match.');
  for (const b of report.batches) {
    const head = `${b.batchKey}: ${b.requests} rider(s), ${b.offers} driver(s)`;
    if (b.error) { console.log(`${head} -> FAILED: ${b.error}`); continue; }
    if (!b.requests || !b.offers) { console.log(`${head} -> nothing to pair`); continue; }

    const written = dryRun ? 'dry run, not written' : `${b.applied.length} written`;
    console.log(`${head} -> ${b.matches.length} match(es), ${written}`);
    for (const m of b.matches) {
      const added = `${m.driverAddedMinutes >= 0 ? '+' : ''}${m.driverAddedMinutes.toFixed(1)}`;
      console.log(`  ${m.reqId} -> ${m.offerId}   rider detour ${m.riderDetour.toFixed(1)} min, driver ${added} min`);
    }
    for (const s of b.writeSkips) console.log(`  not written: ${s.reqId} (${s.reason})`);
    for (const u of b.unmatched) {
      console.log(`  not matched: ${u.reqId}`);
      for (const { offerId, reason } of u.byOffer) console.log(`      ${offerId}: ${WHY[reason]}`);
    }
  }
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log('Usage: npm run match -- [--dry-run] [--synthetic | --routes]');
    return 0;
  }
  const dryRun = args.has('--dry-run');
  const useRoutes = args.has('--routes');
  if (useRoutes && args.has('--synthetic')) {
    throw new Error('--synthetic and --routes both choose travel times; pass one.');
  }

  const apiKey = args.has('--synthetic') ? undefined : envValue('GOOGLE_MAPS_API_KEY', 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');
  const db = connect({
    projectId: envValue('FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    serviceAccountPath: envValue('FIREBASE_SERVICE_ACCOUNT'),
  });

  const store: MatchingStore = {
    expireOverdue: (now) => expireOverdue(db, now),
    loadPending: () => loadPending(db),
    loadRequestsById: (ids) => loadRequestsById(db, ids),
    writeMatches: (writes) => writeMatches(db, writes),
  };

  const now = new Date();
  const stamp = now.toLocaleString('en-AU', { timeZone: CAMPUS_TIME_ZONE });
  console.log(`Ribe matching run - ${stamp} (Melbourne)${dryRun ? ' - DRY RUN' : ''}`);
  const buildMatrix = useRoutes ? buildRoutesTravelTimeMatrix : buildGoogleTravelTimeMatrix;
  console.log(!apiKey
    ? 'Travel times: SYNTHETIC estimates - no Google key, or --synthetic given'
    : useRoutes
      ? 'Travel times: Google Routes API (Route Matrix), one matrix per batch'
      : 'Travel times: Google Distance Matrix API, one matrix per batch');

  const report = await runOnce(store, {
    now,
    dryRun,
    travelTimes: async (points) => apiKey
      // Synthetic fallback only for a leg Google can't route at all.
      ? buildMatrix(points, { apiKey, fallback: new SyntheticTravelTime() })
      : new SyntheticTravelTime(),
  });

  printReport(report, dryRun);
  return report.batches.some((b) => b.error) ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Matching run failed: ${message}`);
    if (/default credentials/i.test(message)) {
      console.error(
        'No Firebase admin credentials. In the Firebase console: Project settings > Service accounts >\n' +
        'Generate new private key. Save it OUTSIDE the repo (it grants full database access) and set\n' +
        'FIREBASE_SERVICE_ACCOUNT=<path to the .json>. Or set FIRESTORE_EMULATOR_HOST to use the emulator.',
      );
    }
    process.exitCode = 1;
  },
);
