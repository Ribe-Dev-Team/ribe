/*
Runs one matching pass against Firestore. From matching/:

    npm run match                  write matches and expiries
    npm run match -- --dry-run     compute and print only, write nothing
    npm run match -- --synthetic   estimated travel times, no Google calls
    npm run match -- --distance-matrix
                                   legacy Distance Matrix API instead of Routes,
                                   for a key whose project predates March 2025

Configuration, from the environment, falling back to mobile/.env for the two
values the app already has:

    FIREBASE_SERVICE_ACCOUNT   path to a service-account JSON key (or set
                               GOOGLE_APPLICATION_CREDENTIALS instead)
    FIREBASE_PROJECT_ID        falls back to EXPO_PUBLIC_FIREBASE_PROJECT_ID
    GOOGLE_MAPS_API_KEY        falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
                               needs the Routes API enabled (or Distance Matrix,
                               with --distance-matrix). With no key, travel
                               times are synthetic estimates.
    FIRESTORE_EMULATOR_HOST    run against the local emulator, no credentials

One run is one pass. How often to run it (every 15 minutes, hourly) is a
scheduling choice - cron, Task Scheduler or a CI schedule all work - and more
frequent runs fill cars faster, since each run offers a driver one new rider.
*/

import { SkipReason } from '../src/adapter';
import { CAMPUS_TIME_ZONE } from '../src/melbourneTime';
import {
  buildGoogleTravelTimeMatrix, buildRoutesTravelTimeMatrix, SyntheticTravelTime,
} from '../src/travelTime';
import { envValue } from './env';
import { connect, expireOverdue, loadPending, loadRequestsById, writeMatches } from './firestore';
import { MatchingStore, RunReport, runOnce } from './runOnce';

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
      console.log(`  ${m.reqId} -> ${m.offerId}   rider detour ${m.riderDetour.toFixed(1)} min, driver +${m.driverAddedMinutes.toFixed(1)} min`);
    }
    for (const s of b.writeSkips) console.log(`  not written: ${s.reqId} (${s.reason})`);
  }
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  if (args.has('--help') || args.has('-h')) {
    console.log('Usage: npm run match -- [--dry-run] [--synthetic | --distance-matrix]');
    return 0;
  }
  const dryRun = args.has('--dry-run');
  const legacyMatrix = args.has('--distance-matrix');
  if (legacyMatrix && args.has('--synthetic')) {
    throw new Error('--synthetic and --distance-matrix both choose travel times; pass one.');
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
  const buildMatrix = legacyMatrix ? buildGoogleTravelTimeMatrix : buildRoutesTravelTimeMatrix;
  console.log(!apiKey
    ? 'Travel times: SYNTHETIC estimates - no Google key, or --synthetic given'
    : legacyMatrix
      ? 'Travel times: Google Distance Matrix API (legacy), one matrix per batch'
      : 'Travel times: Google Routes API (Route Matrix), one matrix per batch');

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
