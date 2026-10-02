/**
 * Plugin configuration: environment first, then the small JSON settings file
 * the pet's menu writes, then the built-in defaults.
 *
 * The file lives beside the harness home (`$DSH_HOME/dsh-vk1-pet/config.json`)
 * rather than in the browser, so the poll schedule and the credential-source
 * preference are machine facts shared by every browser rather than per-tab
 * preferences.
 * @module dsh-vk1-pet/host/settings
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Poll intervals the menu offers, in seconds. */
export const INTERVAL_CHOICES = [10, 30, 60, 300];

/** Credential source preferences. */
export const SOURCE_CHOICES = ['auto', 'api-key', 'account'];

/** Default interval, matching the original desktop pet. */
export const DEFAULT_INTERVAL = 30;

/** Default official endpoint origin. */
export const DEFAULT_ENDPOINT = 'https://api.deepseek.com';

/** Default credential reference name. */
export const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY';

/** Request timeout for one balance read. */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Resolve the harness home the way the rest of DSH does.
 * @returns the absolute harness home directory.
 */
function harnessHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return join(homedir(), '.dsh');
}

/**
 * Directory holding this plugin's own state.
 * @returns the absolute settings directory.
 */
export function settingsDir() {
  const override = process.env.DSHPET_HOME;
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  return join(harnessHome(), 'dsh-vk1-pet');
}

/**
 * Absolute path of the mutable settings file.
 * @returns the settings file path.
 */
export function settingsPath() {
  return join(settingsDir(), 'config.json');
}

/**
 * Coerce a candidate interval to one the menu can offer.
 * @param value - candidate seconds.
 * @returns a valid interval, or null.
 */
function coerceInterval(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return INTERVAL_CHOICES.includes(seconds) ? seconds : null;
}

/**
 * Coerce a candidate credential-source preference.
 * @param value - candidate preference.
 * @returns a valid preference, or null.
 */
function coerceSource(value) {
  return SOURCE_CHOICES.includes(value) ? value : null;
}

/**
 * Normalise one exact HTTPS origin, refusing anything that could carry user
 * information, a query, or a non-HTTPS scheme.
 * @param value - candidate origin.
 * @returns the normalised origin, or null when it must be refused.
 */
function coerceEndpoint(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.search !== '' || url.hash !== '') return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

/**
 * Read the persisted settings file.
 * @returns the stored fields, or an empty object when absent or malformed.
 */
export async function readSettings() {
  try {
    const text = await readFile(settingsPath(), 'utf8');
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

/**
 * Persist the mutable settings fields.
 * @param patch - fields to merge into the stored document.
 * @returns the merged document after the write.
 */
export async function writeSettings(patch) {
  const current = await readSettings();
  const merged = { ...current, ...patch };
  const path = settingsPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  return merged;
}

/**
 * Compose the effective configuration from the in-process overrides the pet's
 * own menu writes, the environment, the stored file, and the defaults.
 * @param stored - the already-read settings document.
 * @param overrides - values this process changed at runtime through the menu.
 * @returns the resolved configuration.
 */
export function resolveConfig(stored = {}, overrides = {}) {
  const endpointEnv = coerceEndpoint(process.env.DSHPET_ENDPOINT);
  const timeoutEnv = Number(process.env.DSHPET_TIMEOUT_MS);

  const intervalSeconds = coerceInterval(overrides.intervalSeconds)
    ?? coerceInterval(process.env.DSHPET_INTERVAL)
    ?? coerceInterval(stored.intervalSeconds)
    ?? DEFAULT_INTERVAL;
  const source = coerceSource(overrides.source)
    ?? coerceSource(process.env.DSHPET_SOURCE)
    ?? coerceSource(stored.source)
    ?? 'auto';

  const ref = process.env.DSHPET_API_KEY_REF;

  return {
    intervalSeconds,
    source,
    endpoint: endpointEnv ?? DEFAULT_ENDPOINT,
    apiKeyRef: typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : DEFAULT_API_KEY_REF,
    timeoutMs: Number.isFinite(timeoutEnv) && timeoutEnv > 0 ? Math.min(120_000, timeoutEnv) : DEFAULT_TIMEOUT_MS,
    offline: process.env.DSHPET_OFFLINE === '1',
    locale: typeof process.env.DSHPET_LOCALE === 'string' && process.env.DSHPET_LOCALE.trim() !== ''
      ? process.env.DSHPET_LOCALE.trim()
      : 'zh_CN',
    version: typeof process.env.DSH_CLIENT_VERSION === 'string' && process.env.DSH_CLIENT_VERSION.trim() !== ''
      ? process.env.DSH_CLIENT_VERSION.trim()
      : '1.0.0',
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
  };
}
