import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { DocumentSnapshot, FieldValue, Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { MATCHABLE_APP_STATUS, OfferDoc, RequestDoc } from '../src/adapter';
import {
  FieldUpdate, MatchWrite, MatchWriteSkip, planMatchWrite, planSettle, Settled, StoredOffer, StoredRequest,
} from '../src/writes';

/**
 * The runner's only contact with Firestore. It uses the Admin SDK, not the app's
 * client SDK: the runner is a trusted server process, and the app's
 * firebaseConfig.ts pulls in React Native storage that plain Node can't load.
 *
 * Every write re-reads its documents inside a transaction and asks
 * src/writes.ts what to do, because the run works from a snapshot.
 */

const REQUESTS = 'rideRequests';
const OFFERS = 'rideOffers';

export interface ConnectOptions {
  projectId?: string;
  /** Path to a service-account JSON key. Without one, Application Default
   *  Credentials are used (GOOGLE_APPLICATION_CREDENTIALS), and none at all are
   *  needed when FIRESTORE_EMULATOR_HOST points at the emulator. */
  serviceAccountPath?: string;
}

export function connect(opts: ConnectOptions): Firestore {
  if (getApps().length === 0) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: opts.projectId ?? 'demo-ribe' });
    } else if (opts.serviceAccountPath) {
      const account = JSON.parse(readFileSync(opts.serviceAccountPath, 'utf8'));
      initializeApp({ credential: cert(account), projectId: opts.projectId ?? account.project_id });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: opts.projectId });
    }
  }
  return getFirestore();
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Timestamp) return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return undefined;
}

function toRequestDoc(snap: DocumentSnapshot): RequestDoc {
  const d = snap.data() ?? {};
  return {
    id: snap.id,
    userId: d.userId,
    status: d.status,
    toUni: d.toUni,
    coord: d.coord,
    // An invalid Date, not a throw: the adapter reports it as BAD_TIME.
    date: toDate(d.date) ?? new Date(NaN),
    departureTime: d.departureTime,
    arrivalTime: d.arrivalTime,
  };
}

function toOfferDoc(snap: DocumentSnapshot): OfferDoc {
  const d = snap.data() ?? {};
  return {
    ...toRequestDoc(snap),
    maxDetourTime: d.maxDetourTime,
    seatCapacity: d.seatCapacity,
    pendingRequestId: d.pendingRequestId ?? null,
    confirmedRequestIds: d.confirmedRequestIds ?? [],
  };
}

function toStoredRequest(snap: DocumentSnapshot): StoredRequest | undefined {
  if (!snap.exists) return undefined;
  const d = snap.data()!;
  return { status: d.status, matchedOfferId: d.matchedOfferId, acceptDeadline: toDate(d.acceptDeadline) };
}

function toStoredOffer(snap: DocumentSnapshot): StoredOffer | undefined {
  if (!snap.exists) return undefined;
  const d = snap.data()!;
  return {
    status: d.status,
    seatCapacity: d.seatCapacity,
    pendingRequestId: d.pendingRequestId ?? null,
    confirmedRequestIds: d.confirmedRequestIds ?? [],
  };
}

function toFirestoreUpdate(u: FieldUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { ...u.set };
  for (const field of u.remove) out[field] = FieldValue.delete();
  return out;
}

/** Every request and offer still looking for a match. */
export async function loadPending(db: Firestore): Promise<{ requests: RequestDoc[]; offers: OfferDoc[] }> {
  const [requests, offers] = await Promise.all([
    db.collection(REQUESTS).where('status', '==', MATCHABLE_APP_STATUS).get(),
    db.collection(OFFERS).where('status', '==', MATCHABLE_APP_STATUS).get(),
  ]);
  return { requests: requests.docs.map(toRequestDoc), offers: offers.docs.map(toOfferDoc) };
}

/** The stored requests of already-confirmed riders, by id, to rebuild each trip's onBoard. */
export async function loadRequestsById(db: Firestore, ids: string[]): Promise<Map<string, RequestDoc>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const snaps = await db.getAll(...unique.map((id) => db.collection(REQUESTS).doc(id)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, toRequestDoc(s)]));
}

/**
 * Settle every matched request against its offer (src/writes.ts → planSettle):
 * expire the matches past their deadline, and return riders to the pool when
 * their driver removed the offer. Runs before matching so a freed driver or
 * rider can be matched again in the same run.
 */
export async function settleMatched(db: Firestore, now: Date): Promise<Settled> {
  const matched = await db.collection(REQUESTS).where('status', 'in', ['awaiting', 'confirmed']).get();

  const settled: Settled = { released: [], expired: [] };
  for (const snap of matched.docs) {
    const outcome = await db.runTransaction(async (tx) => {
      const requestRef = db.collection(REQUESTS).doc(snap.id);
      const requestSnap = await tx.get(requestRef);
      const request = toStoredRequest(requestSnap);
      if (!request) return null;

      const offerRef = request.matchedOfferId ? db.collection(OFFERS).doc(request.matchedOfferId) : null;
      const offer = offerRef ? toStoredOffer(await tx.get(offerRef)) : undefined;

      const plan = planSettle(snap.id, request, offer, now);
      if (!plan) return null;
      tx.update(requestRef, toFirestoreUpdate(plan.request));
      if (plan.offer && offerRef) tx.update(offerRef, toFirestoreUpdate(plan.offer));
      return plan.outcome;
    });
    if (outcome === 'RELEASED') settled.released.push(snap.id);
    if (outcome === 'EXPIRED') settled.expired.push(snap.id);
  }
  return settled;
}

/**
 * Write a run's matches, one transaction each. Sequential, not parallel: two
 * matches from overlapping runs can contend for one offer, and each must see the
 * other's result. Returns what landed and why the rest didn't.
 */
export async function writeMatches(
  db: Firestore,
  writes: MatchWrite[],
): Promise<{ applied: string[]; skipped: Array<{ reqId: string; reason: MatchWriteSkip }> }> {
  const applied: string[] = [];
  const skipped: Array<{ reqId: string; reason: MatchWriteSkip }> = [];

  for (const m of writes) {
    const result = await db.runTransaction(async (tx) => {
      const requestRef = db.collection(REQUESTS).doc(m.reqId);
      const offerRef = db.collection(OFFERS).doc(m.offerId);
      const [requestSnap, offerSnap] = await Promise.all([tx.get(requestRef), tx.get(offerRef)]);

      const plan = planMatchWrite(toStoredRequest(requestSnap), toStoredOffer(offerSnap), m);
      if (!plan.ok) return plan;
      tx.update(requestRef, toFirestoreUpdate(plan.request));
      tx.update(offerRef, toFirestoreUpdate(plan.offer));
      return plan;
    });
    if (result.ok) applied.push(m.reqId);
    else skipped.push({ reqId: m.reqId, reason: result.reason });
  }
  return { applied, skipped };
}
