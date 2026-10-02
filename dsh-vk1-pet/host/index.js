/**
 * dsh-vk1-pet — host half.
 *
 * The original VK-1 desktop pet was a standalone macOS/Windows app that read
 * the harness credential file itself. As a harness plugin the same job splits
 * cleanly: this half reads credentials through the harness's own services
 * (`ctx.credentials`, `ctx.deepseekAccount`), polls the balance, and publishes
 * one small JSON projection on the host web server; the browser half renders
 * the pet and owns every animation.
 *
 * Configuration is environment-and-file based, deliberately without a cordis
 * config schema, so the bundle installs from a bare checkout with no build
 * step on the host side:
 *
 * | Variable | Meaning |
 * | --- | --- |
 * | `DSHPET_HOME` | State directory (default `$DSH_HOME/dsh-vk1-pet`) |
 * | `DSHPET_INTERVAL` | Poll interval in seconds (10, 30, 60, 300) |
 * | `DSHPET_SOURCE` | `auto`, `api-key`, or `account` |
 * | `DSHPET_API_KEY_REF` | Credential reference (default `DEEPSEEK_API_KEY`) |
 * | `DSHPET_KEY` | Literal API key that wins over the store |
 * | `DSHPET_ENDPOINT` | Alternate HTTPS origin for the API-key balance |
 * | `DSHPET_TIMEOUT_MS` | Per-request timeout |
 * | `DSHPET_OFFLINE=1` | Skip credentials and networking entirely |
 * @module dsh-vk1-pet
 */

import { readFileSync } from 'node:fs';

import { createPoller } from './poller.js';
import { mountRoutes } from './routes.js';
import { readSettings, resolveConfig } from './settings.js';

/** Cordis plugin name; also the client bundle id and the settings scope. */
export const name = 'dsh-vk1-pet';

/** The web server owns the route table this plugin mounts into. */
export const inject = ['webServer'];

/** This package's manifest version, used for diagnostics and cache busting. */
export const version = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/**
 * Load the plugin.
 * @param ctx - host plugin context; `ctx.webServer` is ready before `apply` runs.
 */
export function apply(ctx) {
  // Menu-written values live for the process lifetime; the file makes them
  // survive a restart, and the in-memory copy keeps them authoritative for the
  // rest of this run without racing the file watcher.
  const overrides = {};

  ctx.effect(() => {
    let disposed = false;
    let unmount = null;
    let poller = null;

    void (async () => {
      const stored = await readSettings();
      if (disposed) return;
      const config = { ...resolveConfig(stored, overrides), version };
      poller = createPoller(ctx, config);
      unmount = mountRoutes(ctx, { poller, overrides, log: ctx.logger });
      ctx.logger?.info?.(
        'dsh-vk1-pet: mounted on %s (interval %ss, source %s%s)',
        '/dsh-vk1-pet', config.intervalSeconds, config.source, config.offline ? ', offline demo' : '',
      );
      poller.start();
    })().catch((error) => {
      ctx.logger?.error?.('dsh-vk1-pet: startup failed: %s', error?.stack ?? error);
    });

    return () => {
      disposed = true;
      unmount?.();
      poller?.dispose();
    };
  }, 'dsh-vk1-pet: balance poller and routes');
}
