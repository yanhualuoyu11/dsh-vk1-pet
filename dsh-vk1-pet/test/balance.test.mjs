import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';

import { fetchApiKeyBalance } from '../host/balance.js';

/**
 * Serve one canned response and record what the client sent.
 * @param handler - `(req, res) => void`.
 * @returns the origin, the captured requests, and a close function.
 */
async function withServer(handler) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const OPTIONS = { timeoutMs: 5000, label: 'DEEPSEEK_API_KEY' };

test('an API-key balance is summed to fen and the token rides the bearer header', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '9.99', granted_balance: '0', topped_up_balance: '9.99' },
        { currency: 'CNY', total_balance: '31.40', granted_balance: '0.00', topped_up_balance: '31.40' },
      ],
    }));
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test' });
    assert.equal(reading.ok, true);
    assert.equal(reading.fen, 3140n);
    assert.equal(reading.mode, 'api-key');
    assert.equal(reading.source, 'API Key');
    assert.equal(reading.detail, 'DEEPSEEK_API_KEY');
    assert.equal(server.seen[0].url, '/user/balance');
    assert.equal(server.seen[0].headers.authorization, 'Bearer sk-test');
  } finally {
    await server.close();
  }
});

test('a rejected key reports authentication failure instead of a zero balance', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(401);
    res.end('{}');
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-bad' });
    assert.equal(reading.ok, false);
    assert.equal(reading.kind, 'auth');
    assert.equal(reading.fen, undefined);
  } finally {
    await server.close();
  }
});

test('a 429 carries its Retry-After through', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(429, { 'retry-after': '42' });
    res.end('{}');
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test' });
    assert.equal(reading.ok, false);
    assert.equal(reading.kind, 'rate-limit');
    assert.equal(reading.retryAfterSeconds, 42);
  } finally {
    await server.close();
  }
});

test('a malformed envelope is a parse failure', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ is_available: true }));
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test' });
    assert.equal(reading.ok, false);
    assert.equal(reading.kind, 'parse');
  } finally {
    await server.close();
  }
});

test('a non-JSON body is a parse failure', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html></html>');
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test' });
    assert.equal(reading.ok, false);
    assert.equal(reading.kind, 'parse');
  } finally {
    await server.close();
  }
});

test('an unreachable endpoint is a transport failure', async () => {
  const server = await withServer((req, res) => { res.end(); });
  const origin = server.origin;
  await server.close();
  const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: origin, token: 'sk-test' });
  assert.equal(reading.ok, false);
  assert.equal(reading.kind, 'transport');
});

test('a timeout is a transport failure, not a hang', async () => {
  const server = await withServer(() => { /* never answers */ });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test', timeoutMs: 150 });
    assert.equal(reading.ok, false);
    assert.equal(reading.kind, 'transport');
  } finally {
    await server.close();
  }
});

test('a redirect is refused rather than followed with the token', async () => {
  const server = await withServer((req, res) => {
    res.writeHead(302, { location: 'http://127.0.0.1:1/user/balance' });
    res.end();
  });
  try {
    const reading = await fetchApiKeyBalance({ ...OPTIONS, endpoint: server.origin, token: 'sk-test' });
    assert.equal(reading.ok, false);
    assert.equal(server.seen.length, 1, 'the redirect target is never contacted');
  } finally {
    await server.close();
  }
});
