import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** mobile/.env as key/value pairs, or empty if it isn't there. */
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

/**
 * `name` from the environment, else `fallback` (one of the app's EXPO_PUBLIC_
 * names) from the environment or mobile/.env - so the values the app already
 * has never need copying.
 */
export function envValue(name: string, fallback?: string): string | undefined {
  if (process.env[name]) return process.env[name];
  if (!fallback) return undefined;
  return process.env[fallback] || readMobileEnv()[fallback];
}
