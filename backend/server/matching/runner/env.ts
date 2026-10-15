import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// From backend/server/matching/runner: up three to backend/, four to the repo.
const BACKEND_ENV = resolve(__dirname, '..', '..', '..', '.env');
const MOBILE_ENV = resolve(__dirname, '..', '..', '..', '..', 'mobile', '.env');

/** A .env file as key/value pairs, or empty if it isn't there. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * `name` from the environment, else backend/.env. Failing that, `fallback`
 * (one of the app's EXPO_PUBLIC_ names) from the environment, backend/.env or
 * mobile/.env - so the values the app already has never need copying.
 *
 * backend/.env is where FIREBASE_SERVICE_ACCOUNT, the path to your own admin
 * key, belongs. Both it and any *-firebase-adminsdk-*.json are gitignored, so
 * neither can be committed by accident. It holds the path, not the key: .env
 * files get passed around the team, and the key must not travel with them.
 */
export function envValue(name: string, fallback?: string): string | undefined {
  const backend = readEnvFile(BACKEND_ENV);
  const own = process.env[name] || backend[name];
  if (own || !fallback) return own || undefined;
  return process.env[fallback] || backend[fallback] || readEnvFile(MOBILE_ENV)[fallback];
}
