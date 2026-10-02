/**
 * HTTP surface of the pet plugin, mounted on the host's own web server.
 *
 * These are plain same-origin routes rather than harness RPC endpoints: the
 * payload is a read-only balance projection plus two small commands, so a
 * bespoke envelope would add a schema and a codec for nothing. Every request
 * still passes the harness's own trust fence first, so a non-loopback or
 * cross-site caller is refused exactly as it would be on `/api`.
 * @module dsh-vk1-pet/host/routes
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join } from 'node:path';

import { INTERVAL_CHOICES, SOURCE_CHOICES, resolveConfig, writeSettings } from './settings.js';

/** URL prefix owned by this plugin. */
export const BASE_PATH = '/dsh-vk1-pet';

/** Largest accepted JSON command body. */
const MAX_BODY_BYTES = 8 * 1024;

/** Assets the client may fetch, mapped to their media type. */
const ASSETS = new Map([
  ['sprite.png', 'image/png'],
  ['sprite-gpt.png', 'image/png'],
  ['sprite-claude.png', 'image/png'],
  ['sprite-gemini.png', 'image/png'],
  ['sprite-deepseek-offline.png', 'image/png'],
  ['hit.mp3', 'audio/mpeg'],
]);

/** Directory holding the character art and the hit sound. */
const ASSET_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

/**
 * Write a JSON response.
 * @param res - node response.
 * @param status - HTTP status.
 * @param payload - JSON-serialisable body.
 */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/**
 * Decide whether the harness trust fence admits this request.
 *
 * The connection service owns the browser cookie check and the Host/Origin
 * fence; when it is absent (a headless composition) only loopback callers are
 * served, which is the same posture as a server bound to 127.0.0.1.
 * @param ctx - host plugin context.
 * @param req - node request.
 * @returns the rejection status, or undefined when the request is admitted.
 */
function rejectionFor(ctx, req) {
  const connection = ctx.get('connection');
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    try {
      return connection.requestRejection.call(connection, req);
    } catch {
      return 403;
    }
  }
  const host = req.headers?.host;
  if (typeof host !== 'string') return 403;
  const hostname = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0];
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  if (!loopback) return 403;
  if (req.headers['sec-fetch-site'] === 'cross-site') return 403;
  const origin = req.headers.origin;
  if (origin === undefined) return undefined;
  try {
    return new URL(origin).host === host ? undefined : 403;
  } catch {
    return 403;
  }
}

/**
 * Read and parse a small JSON request body.
 * @param req - node request.
 * @returns the parsed object, or null when the body is absent or malformed.
 */
async function readJsonBody(req) {
  const declared = req.headers['content-length'];
  if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) return null;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) return null;
    chunks.push(chunk);
  }
  if (total === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Serve one whitelisted asset.
 * @param req - node request.
 * @param res - node response.
 * @param name - requested file name.
 */
async function serveAsset(req, res, name) {
  const mediaType = ASSETS.get(name);
  if (mediaType === undefined) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  const path = join(ASSET_DIR, name);
  let info;
  try {
    info = await stat(path);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('asset missing');
    return;
  }
  const etag = `"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': mediaType,
    'content-length': String(info.size),
    'cache-control': 'public, max-age=86400',
    etag,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  await new Promise((resolve) => {
    const stream = createReadStream(path);
    stream.on('error', () => {
      res.destroy();
      resolve();
    });
    stream.on('close', resolve);
    stream.pipe(res);
  });
}

/**
 * Mount every route this plugin owns.
 * @param ctx - host plugin context.
 * @param options - the poller, a logger, and the current resolved config.
 * @returns a disposer removing every route.
 */
export function mountRoutes(ctx, options) {
  const { poller, log } = options;
  const webServer = ctx.webServer;
  const disposers = [];

  /**
   * Wrap one handler with the trust fence and a uniform failure answer.
   * @param handler - the route body.
   * @returns a node request listener.
   */
  function guard(handler) {
    return async (req, res) => {
      const rejection = rejectionFor(ctx, req);
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
        return;
      }
      try {
        await handler(req, res);
      } catch (error) {
        log?.warn?.('dsh-vk1-pet: %s failed: %s', req.url, error?.message ?? error);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal' });
        else res.destroy();
      }
    };
  }

  /**
   * Register one route and remember its disposer.
   * @param route - the webserver route descriptor.
   */
  function register(route) {
    const dispose = webServer.register(route);
    if (typeof dispose === 'function') disposers.push(dispose);
  }

  register({
    kind: 'exact',
    path: `${BASE_PATH}/api/state`,
    handler: guard(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      sendJson(res, 200, { ok: true, state: poller.snapshot() });
    }),
  });

  register({
    kind: 'exact',
    path: `${BASE_PATH}/api/refresh`,
    handler: guard(async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      await readJsonBody(req);
      await poller.refresh();
      sendJson(res, 200, { ok: true, state: poller.snapshot() });
    }),
  });

  register({
    kind: 'exact',
    path: `${BASE_PATH}/api/settings`,
    handler: guard(async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' });
        return;
      }
      const body = await readJsonBody(req);
      if (body === null) {
        sendJson(res, 400, { ok: false, error: 'invalid body' });
        return;
      }
      const patch = {};
      if (body.intervalSeconds !== undefined) {
        const seconds = Number(body.intervalSeconds);
        if (!INTERVAL_CHOICES.includes(seconds)) {
          sendJson(res, 400, { ok: false, error: 'unsupported interval' });
          return;
        }
        patch.intervalSeconds = seconds;
      }
      if (body.source !== undefined) {
        if (!SOURCE_CHOICES.includes(body.source)) {
          sendJson(res, 400, { ok: false, error: 'unsupported source' });
          return;
        }
        patch.source = body.source;
      }
      if (Object.keys(patch).length === 0) {
        sendJson(res, 400, { ok: false, error: 'nothing to update' });
        return;
      }
      const stored = await writeSettings(patch);
      if (patch.intervalSeconds !== undefined) {
        options.overrides.intervalSeconds = patch.intervalSeconds;
        poller.setInterval(patch.intervalSeconds);
      }
      if (patch.source !== undefined) options.overrides.source = patch.source;
      poller.reconfigure(resolveConfig(stored, options.overrides));
      if (patch.source !== undefined) await poller.refresh();
      sendJson(res, 200, { ok: true, state: poller.snapshot() });
    }),
  });

  register({
    kind: 'prefix',
    path: `${BASE_PATH}/assets`,
    handler: guard(async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('method not allowed');
        return;
      }
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const name = pathname.slice(`${BASE_PATH}/assets/`.length);
      if (name === '' || name.includes('/') || name.includes('\\') || extname(name) === '') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      await serveAsset(req, res, name);
    }),
  });

  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch {
        /* already removed */
      }
    }
  };
}
