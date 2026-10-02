/**
 * Integration smoke test for the shipped browser bundle.
 *
 * It loads the real `client/client.js` through the same registration facade the
 * DSH browser module table uses, runs the plugin's own `apply` against a stub
 * slot registry, and renders the registered overlay to a string. That covers
 * the whole browser half short of a real DOM: the entry contract, the slot
 * registration, and one full render of the pet with a balance already known.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

/** Bumped per load so each test imports a fresh module instance. */
let loadCounter = 0;

/** Preferences the fake browser starts with. */
function installBrowserStubs() {
  const store = new Map();
  const appended = [];
  const style = { dataset: {}, textContent: '', remove() {} };

  globalThis.window = {
    innerWidth: 1440,
    innerHeight: 900,
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(key, String(value)); },
      removeItem: (key) => { store.delete(key); },
    },
    addEventListener() {},
    removeEventListener() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  globalThis.document = {
    head: { appendChild: (tag) => appended.push(tag) },
    createElement: (tag) => (tag === 'style' ? style : { getContext: () => null }),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.Element = class Element {};
  return { store, appended, style };
}

/**
 * Load the built bundle and run its `apply` against a stub client context.
 * @returns the registered slot entries plus the stub browser bookkeeping.
 */
async function loadPlugin() {
  const browser = installBrowserStubs();
  const registrations = [];
  const cleanups = [];

  let registration = null;
  globalThis.window.__ModuleLoader__ = { load: (value) => { registration = value; } };
  // A unique query keeps each test on a fresh module instance: a plain import
  // would hit the ESM cache and never re-execute the registration.
  const bundleUrl = new URL('../client/client.js', import.meta.url);
  bundleUrl.searchParams.set('t', String((loadCounter += 1)));
  await import(bundleUrl.href);
  assert.ok(registration !== null, 'the bundle must register through __ModuleLoader__.load');

  const moduleExports = registration.factory((specifier) => require(specifier));
  assert.equal(typeof moduleExports.apply, 'function');
  assert.deepEqual(moduleExports.inject, ['slots']);

  const ctx = {
    effect: (body) => {
      const dispose = body();
      cleanups.push(dispose);
      return () => { if (typeof dispose === 'function') dispose(); };
    },
    slots: {
      inject: (_slot, body) => body(),
      register: (options, component) => {
        registrations.push({ options, component });
        return () => {};
      },
    },
  };
  moduleExports.apply(ctx);

  return { browser, registration, moduleExports, registrations, cleanups };
}

test('the bundle registers one shell.overlay entry and injects its stylesheet', async () => {
  const { browser, registration, registrations } = await loadPlugin();
  assert.equal(registration.id, 'dsh-vk1-pet', 'the registration id must equal the package name');
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].options.name, 'shell.overlay');
  assert.equal(registrations[0].options.id, 'vk1-pet');
  assert.equal(typeof registrations[0].options.order, 'number');
  assert.equal(browser.appended.length, 1, 'one <style> tag is injected');
  assert.match(browser.style.textContent, /vk1p-root/);
});

test('the overlay renders the pet, the tablet readout, and the balance pill', async () => {
  const { browser, registrations } = await loadPlugin();
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = require('react');
  // A guest character never swaps to holding-basin art, so a cold render (no
  // host state yet) still paints the sprite and its tablet.
  browser.store.set('dsh-vk1-pet:v1:character', JSON.stringify('gpt'));

  const html = renderToStaticMarkup(React.createElement(registrations[0].component));
  assert.match(html, /data-dsh-vk1-pet/);
  assert.match(html, /vk1p-root/, 'the pet canvas is rendered');
  assert.match(html, /DSH 余额/, 'the tablet caption is rendered');
  assert.match(html, /vk1p-pill/, 'the always-available balance pill is rendered');
  assert.match(html, /sprite-gpt\.png/, 'the selected character art is requested');
  assert.match(html, /\/dsh-vk1-pet\/assets\//);
  assert.match(html, /matrix\(/, 'the tablet text is mapped onto the artwork corners');
});

test('the unconfigured whale renders the holding-basin art instead of the tablet', async () => {
  installBrowserStubs();
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = require('react');
  // A click-through probe is not needed here: the offline artwork is chosen
  // from the host state, which starts as "connecting" on a cold render.
  const { registrations } = await loadPlugin();
  const html = renderToStaticMarkup(React.createElement(registrations[0].component));
  assert.match(html, /sprite-deepseek-offline\.png/);
  assert.doesNotMatch(html, /vk1p-tablet/);
});

test('every character can be selected without a render crash', async () => {
  const { browser, registrations } = await loadPlugin();
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = require('react');
  for (const id of ['deepseek', 'gpt', 'claude', 'gemini']) {
    browser.store.set('dsh-vk1-pet:v1:character', JSON.stringify(id));
    const html = renderToStaticMarkup(React.createElement(registrations[0].component));
    assert.match(html, /data-dsh-vk1-pet/, `character ${id} renders`);
  }
});

test('a hidden pet still renders the pill, and a corrupt preference falls back', async () => {
  const { browser, registrations } = await loadPlugin();
  const { renderToStaticMarkup } = await import('react-dom/server');
  const React = require('react');
  browser.store.set('dsh-vk1-pet:v1:hidden', 'true');
  browser.store.set('dsh-vk1-pet:v1:size', JSON.stringify('nonsense'));
  browser.store.set('dsh-vk1-pet:v1:character', 'not json at all');
  browser.store.set('dsh-vk1-pet:v1:position', JSON.stringify({ left: 'x', bottom: null }));
  let html;
  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(React.createElement(registrations[0].component));
  });
  assert.doesNotMatch(html, /vk1p-root/, 'the pet canvas is hidden');
  assert.match(html, /vk1p-pill/, 'the pill stays available');
});
