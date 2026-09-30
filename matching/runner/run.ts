/*
Runs one matching pass against Firestore. From matching/:

    npm run match                  write matches and expiries
    npm run match -- --dry-run     compute and print only, write nothing
    npm run match -- --synthetic   estimated travel times, no Google calls

Configuration, from the environment, falling back to mobile/.env for the two
values the app already has:

    FIREBASE_SERVICE_ACCOUNT   path to a service-account JSON key (or set
                               GOOGLE_APPLICATION_CREDENTIALS instead)
    FIREBASE_PROJECT_ID        falls back to EXPO_PUBLIC_FIREBASE_PROJECT_ID
    GOOGLE_MAPS_API_KEY        falls back to EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
                               needs the Routes API enabled. With no key, travel
                               times are synthetic estimates.
    FIRESTORE_EMULATOR_HOST    run against the local emulator, no credentials

One run is one pass. How often to run it (every 15 minutes, hourly) is a
scheduling choice - cron, Task Scheduler or a CI schedule all work - and more
frequent runs fill cars faster, since each run offers a driver one new rider.
*/

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SkipReason } from '../src/adapter';
import { CAMPUS_TIME_ZONE } from '../src/melbourneTime';
import { buildRoutesTravelTimeMatrix, SyntheticTravelTime } from '../src/travelTime';
import { connect, expireOverdue, loadPending, loadRequestsById, writeMatches } from './firestore';
import { MatchingStore, RunReport, runOnce } from './runOnce';

function readMobileEnv(): Record<string, string> {
  const path = resolve(__dirname, '..', '..', 'mobile', '.env');
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

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
    console.log('Usage: npm run match -- [--dry-run] [--synthetic]');
    return 0;
  }
  const dryRun = args.has('--dry-run');

  const mobileEnv = readMobileEnv();
  const env = (name: string, fallback?: string) =>
    process.env[name] || (fallback ? process.env[fallback] || mobileEnv[fallback] : undefined);

  const apiKey = args.has('--synthetic') ? undefined : env('GOOGLE_MAPS_API_KEY', 'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY');
  const db = connect({
    projectId: env('FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    serviceAccountPath: env('FIREBASE_SERVICE_ACCOUNT'),
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
  console.log(apiKey
    ? 'Travel times: Google Routes API (Route Matrix), one matrix per batch'
    : 'Travel times: SYNTHETIC estimates - no Google key, or --synthetic given');

  const report = await runOnce(store, {
    now,
    dryRun,
    travelTimes: async (points) => apiKey
      // Synthetic fallback only for a leg Google can't route at all.
      ? buildRoutesTravelTimeMatrix(points, { apiKey, fallback: new SyntheticTravelTime() })
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
