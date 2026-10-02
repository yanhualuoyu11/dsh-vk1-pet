/**
 * The browser half's thin client over the host routes.
 *
 * Requests are same-origin, so the harness's own browser cookie rides along and
 * the host trust fence admits them exactly as it admits `/api`. Failures stay
 * quiet: a pet that cannot reach its host renders the offline artwork rather
 * than an error dialog.
 * @module dsh-vk1-pet/client/api
 */

import { BASE_PATH } from './constants.js';

/** How long one control request may take before it is treated as a failure. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Fetch one JSON route.
 * @param path - route path below the plugin prefix.
 * @param init - optional fetch init; the method defaults to GET.
 * @returns the decoded `state` field.
 * @throws when the host refuses, the payload is malformed, or the request times out.
 */
async function request(path, init = {}) {
  const response = await fetch(`${BASE_PATH}${path}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json', ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...init,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body === null || typeof body !== 'object' || body.ok !== true) {
    throw new Error(typeof body?.error === 'string' ? body.error : 'invalid response');
  }
  return body.state;
}

/**
 * Read the cached host state. Cheap by design: the host answers from memory,
 * so the browser may poll this far more often than the upstream balance.
 * @returns the host state projection.
 */
export function fetchState() {
  return request('/api/state');
}

/**
 * Ask the host to poll upstream immediately.
 * @returns the state after the attempt settled.
 */
export function requestRefresh() {
  return request('/api/refresh', { method: 'POST', body: '{}' });
}

/**
 * Persist a settings change on the host.
 * @param patch - `{ intervalSeconds }` or `{ source }`.
 * @returns the state after the change.
 */
export function updateSettings(patch) {
  return request('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
}
