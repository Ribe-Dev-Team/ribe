/*
One-off backfill: save a `costSplit` onto every rideRequest that was matched
before cost splitting existed.

A request counts as matched when it has `matchedOfferId` and is 'awaiting' or
'confirmed' (see mobile/pages/schema/firebaseBooking.schema.ts on the matching
branch). The split uses TODAY's fuel price, not the price on the day of the
match, and the default vehicle economy since drivers don't record theirs yet.

Dry run by default - prints what it would write. Pass --write to save.

  npm run backfill:cost-splits -- [--write] [--force] [--project <id>] [--service-account <path>]

  --write             save to Firestore (otherwise dry run)
  --force             recalculate requests that already have a costSplit
  --project           Firebase project id (defaults to the key's, or EXPO_PUBLIC_FIREBASE_PROJECT_ID)
  --service-account   Admin SDK key JSON. Without one, Application Default Credentials
                      are used, and none are needed when FIRESTORE_EMULATOR_HOST is set.

Uses the Admin SDK like the matching runner: the app's firebaseConfig.ts pulls
in React Native storage that plain Node can't load, and the Firestore rules
wouldn't let a client write other users' requests anyway.
*/

import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { DocumentData, Firestore, getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const REQUESTS = 'rideRequests';
const OFFERS = 'rideOffers';
const MATCHED_STATUSES = ['awaiting', 'confirmed'];

interface Args {
  write: boolean;
  force: boolean;
  projectId?: string;
  serviceAccountPath?: string;
}

function parseArgs(argv: string[]): Args {
  const valueOf = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    write: argv.includes('--write'),
    force: argv.includes('--force'),
    projectId: valueOf('--project'),
    serviceAccountPath: valueOf('--service-account'),
  };
}

/*
Copy mobile/.env into process.env so the app's services find their API keys.
Must run before those services are imported - they read the keys at load time.
*/
function loadMobileEnv() {
  const path = resolve(__dirname, '..', 'mobile', '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

function connect({ projectId, serviceAccountPath }: Args): Firestore {
  if (getApps().length === 0) {
    const fallbackProject = projectId ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: fallbackProject ?? 'demo-ribe' });
    } else if (serviceAccountPath) {
      const account = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
      initializeApp({ credential: cert(account), projectId: projectId ?? account.project_id });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: fallbackProject });
    }
  }
  return getFirestore();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadMobileEnv();

  const { fetchMedianFuelPrice } = await import('../mobile/services/fuelPrices');
  const { fetchTripDistances } = await import('../mobile/services/routeDistances');
  const { geocodeAddress, isPlacesConfigured, MONASH_CLAYTON_LOCATION } = await import('../mobile/services/googlePlaces');
  const { DEFAULT_VEHICLE_ECONOMY, formatDollars } = await import('../mobile/utility/costSplitting');
  const { buildStoredCostSplit, countTripParticipants, toLatLng, tripLeg } = await import('../mobile/utility/costSplitRecord');

  if (!isPlacesConfigured()) {
    throw new Error('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is not set (mobile/.env) - distances cannot be calculated.');
  }

  // Stored coords first; fall back to geocoding the address for older bookings without one.
  const locate = async (data: DocumentData) => toLatLng(data.coord) ?? (data.address ? geocodeAddress(data.address) : null);

  const db = connect(args);
  const fuel = await fetchMedianFuelPrice();
  console.log(`Fuel: ${fuel.price.toFixed(1)}c/L ${fuel.fuelType} (${fuel.source})`);
  console.log(args.write ? 'Mode: WRITE\n' : 'Mode: dry run (pass --write to save)\n');

  const snap = await db.collection(REQUESTS).where('status', 'in', MATCHED_STATUSES).get();
  const offerCache = new Map<string, DocumentData | null>();
  const counts = { written: 0, wouldWrite: 0, skipped: 0, failed: 0 };

  for (const requestDoc of snap.docs) {
    const request = requestDoc.data();
    const id = requestDoc.id;
    const skip = (reason: string) => {
      counts.skipped++;
      console.log(`- ${id}: skipped, ${reason}`);
    };

    if (!request.matchedOfferId) { skip('no matchedOfferId'); continue; }
    if (request.costSplit && !args.force) { skip('already has a costSplit (use --force)'); continue; }

    try {
      if (!offerCache.has(request.matchedOfferId)) {
        const offerSnap = await db.collection(OFFERS).doc(request.matchedOfferId).get();
        offerCache.set(request.matchedOfferId, offerSnap.exists ? offerSnap.data()! : null);
      }
      const offer = offerCache.get(request.matchedOfferId);
      if (!offer) { skip(`offer ${request.matchedOfferId} not found`); continue; }

      const [riderHome, driverHome] = await Promise.all([locate(request), locate(offer)]);
      if (!riderHome || !driverHome) { skip('could not locate rider or driver address'); continue; }

      const leg = tripLeg(request.toUni !== false, driverHome, riderHome, MONASH_CLAYTON_LOCATION);
      const distances = await fetchTripDistances(leg.origin, leg.destination, leg.via);
      if (!distances) { skip('route distance lookup failed'); continue; }

      const costSplit = buildStoredCostSplit({
        fuel,
        vehicleEconomy: DEFAULT_VEHICLE_ECONOMY,
        ...distances,
        tripParticipants: countTripParticipants(id, offer.confirmedRequestIds),
      });

      console.log(
        `${args.write ? '✓' : '·'} ${id}: ${formatDollars(costSplit.passengerContribution)} ` +
        `(trip ${costSplit.tripDistanceKm.toFixed(1)} km ÷ ${costSplit.tripParticipants}, ` +
        `detour ${costSplit.detourDistanceKm.toFixed(1)} km)`,
      );

      if (args.write) {
        // update(), not set(): only touches costSplit, so a concurrent matcher write isn't clobbered.
        await requestDoc.ref.update({ costSplit });
        counts.written++;
      } else {
        counts.wouldWrite++;
      }
    } catch (err) {
      counts.failed++;
      console.error(`✗ ${id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `\n${snap.size} matched-status requests: ` +
    (args.write ? `${counts.written} written` : `${counts.wouldWrite} would be written`) +
    `, ${counts.skipped} skipped, ${counts.failed} failed.`,
  );
  if (counts.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
