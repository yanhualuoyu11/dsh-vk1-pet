/**
 * Balance poller: the single owner of this plugin's host-side state.
 *
 * One request runs at a time, the next is armed only after the previous one
 * settled (the original desktop pet measured its interval the same way), and a
 * 429 is honoured before any other schedule. The HTTP route reads
 * {@link Poller.snapshot} rather than the network, so the browser never sees a
 * request in flight and N browser tabs still produce one upstream poll.
 * @module dsh-vk1-pet/host/poller
 */

import { readBalance } from './balance.js';
import { fenToString } from './money.js';

/** Longest backoff applied after a rate-limit response without `Retry-After`. */
const MAX_BACKOFF_MS = 300_000;

/** How long a manual refresh stays blocked after a rate-limit answer. */
const MIN_RATE_LIMIT_MS = 5_000;

/**
 * Create the poller.
 * @param ctx - host plugin context used to reach the credential and account services.
 * @param config - resolved configuration.
 * @returns the poller handle.
 */
export function createPoller(ctx, config) {
  let current = config;
  let timer = null;
  let inflight = null;
  let disposed = false;
  let backoffMs = 0;
  let revision = 0;

  const state = {
    status: 'connecting',
    connected: false,
    fen: null,
    spentFen: null,
    source: null,
    detail: null,
    error: null,
    revision: 0,
    updatedAt: null,
    checkedAt: null,
    nextPollAt: null,
    rateLimitedUntil: null,
    polling: false,
  };

  /** Cancel the armed timer. */
  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    state.nextPollAt = null;
  }

  /**
   * Arm the next poll.
   * @param delayMs - delay before the next attempt.
   */
  function schedule(delayMs) {
    if (disposed) return;
    clearTimer();
    const delay = Math.max(250, Math.round(delayMs));
    state.nextPollAt = Date.now() + delay;
    timer = setTimeout(() => {
      timer = null;
      void poll('scheduled');
    }, delay);
    if (typeof timer.unref === 'function') timer.unref();
  }

  /** Apply one reading to the published state. */
  function publish(reading) {
    state.checkedAt = Date.now();
    if (reading.ok) {
      state.status = 'ready';
      state.connected = true;
      state.fen = Number(reading.fen);
      state.spentFen = reading.spentFen === null || reading.spentFen === undefined ? null : Number(reading.spentFen);
      state.source = reading.source ?? null;
      state.detail = reading.detail ?? null;
      state.error = null;
      state.updatedAt = state.checkedAt;
      backoffMs = 0;
      state.rateLimitedUntil = null;
    } else {
      state.status = reading.kind === 'unconfigured' ? 'unconfigured' : 'offline';
      state.connected = false;
      state.error = reading.error ?? '未知错误';
      if (reading.kind === 'unconfigured') state.source = null;
      if (reading.kind === 'rate-limit') {
        const waitMs = Math.max(MIN_RATE_LIMIT_MS, (reading.retryAfterSeconds ?? 0) * 1000);
        state.rateLimitedUntil = state.checkedAt + waitMs;
        backoffMs = waitMs;
      } else {
        state.rateLimitedUntil = null;
        const base = current.intervalSeconds * 1000;
        backoffMs = backoffMs === 0 ? base : Math.min(MAX_BACKOFF_MS, backoffMs * 2);
      }
    }
    revision += 1;
    state.revision = revision;
  }

  /**
   * Run one poll cycle.
   * @param reason - why the poll ran, for diagnostics.
   * @returns the published state after the cycle settled.
   */
  async function poll(reason) {
    if (disposed) return state;
    if (inflight !== null) return inflight;

    if (current.offline) {
      publish({ ok: false, kind: 'transport', error: '演示模式：DSHPET_OFFLINE=1，未读取凭证' });
      schedule(current.intervalSeconds * 1000);
      return state;
    }

    state.polling = true;
    inflight = (async () => {
      let reading;
      try {
        reading = await readBalance(ctx, current);
      } catch (error) {
        reading = { ok: false, kind: 'transport', error: error?.message ?? '余额读取失败' };
      }
      publish(reading);
      state.polling = false;
      if (reading.ok) {
        schedule(current.intervalSeconds * 1000);
      } else if (reading.kind === 'unconfigured') {
        // No credential exists yet. Keep a slow re-check so configuring a key
        // in another tab brings the pet back without restarting the host.
        schedule(Math.max(30_000, current.intervalSeconds * 1000));
      } else {
        schedule(backoffMs);
      }
      return state;
    })().catch((error) => {
      state.polling = false;
      state.status = 'offline';
      state.connected = false;
      state.error = error?.message ?? '余额读取失败';
      revision += 1;
      state.revision = revision;
      schedule(MAX_BACKOFF_MS);
      return state;
    }).finally(() => {
      inflight = null;
    });

    return inflight;
  }

  return {
    /**
     * Current published state.
     * @returns a structured clone safe to serialise.
     */
    snapshot() {
      return {
        status: state.status,
        connected: state.connected,
        fen: state.fen,
        display: state.fen === null ? null : fenToString(BigInt(state.fen)),
        spentFen: state.spentFen,
        spentDisplay: state.spentFen === null ? null : fenToString(BigInt(state.spentFen)),
        source: state.source,
        detail: state.detail,
        error: state.error,
        revision: state.revision,
        updatedAt: state.updatedAt,
        checkedAt: state.checkedAt,
        nextPollAt: state.nextPollAt,
        rateLimitedUntil: state.rateLimitedUntil,
        polling: state.polling,
        intervalSeconds: current.intervalSeconds,
        sourcePreference: current.source,
        offline: current.offline,
        version: current.version,
      };
    },

    /**
     * Force an immediate poll, unless one is already running.
     * @returns the state after the attempt settled.
     */
    async refresh() {
      if (inflight !== null) return inflight;
      clearTimer();
      return poll('manual');
    },

    /**
     * Change the poll interval.
     * @param seconds - a value from `INTERVAL_CHOICES`.
     * @returns the updated snapshot.
     */
    setInterval(seconds) {
      current = { ...current, intervalSeconds: seconds };
      if (inflight === null) schedule(seconds * 1000);
      return this.snapshot();
    },

    /**
     * Re-read the configuration object (after an environment or file change).
     * @param next - the replacement configuration.
     */
    reconfigure(next) {
      current = next;
    },

    /**
     * Start the first poll immediately.
     */
    start() {
      void poll('startup');
    },

    /**
     * Stop the poller and release its timer.
     */
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
