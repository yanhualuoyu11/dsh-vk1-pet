/**
 * Mount the shipped browser bundle in a real DOM and drive it through the host
 * states with a stubbed transport.
 *
 * This is the tier that answers "what does the user actually see": effects run,
 * the poll resolves, and the assertions read the rendered DOM. The string
 * renderer in `overlay.test.mjs` cannot do that, because the artwork choice
 * depends on a state that only arrives from `fetch`.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);

/** Host snapshots the stub transport can answer with. */
const STATES = {
  connecting: {
    status: 'connecting', connected: false, fen: null, display: null,
    spentDisplay: null, source: null, detail: null, error: null,
    revision: 0, intervalSeconds: 30, sourcePreference: 'auto',
  },
  ready: {
    status: 'ready', connected: true, fen: 3070, display: '30.70',
    spentDisplay: null, source: 'API Key', detail: 'DEEPSEEK_API_KEY', error: null,
    revision: 1, intervalSeconds: 30, sourcePreference: 'auto',
  },
  unconfigured: {
    status: 'unconfigured', connected: false, fen: null, display: null,
    spentDisplay: null, source: null, detail: null,
    error: '未找到 API Key 或 DSH 账号凭证', revision: 2, intervalSeconds: 30, sourcePreference: 'auto',
  },
  failed: {
    status: 'offline', connected: false, fen: null, display: null,
    spentDisplay: null, source: 'API Key', detail: 'DEEPSEEK_API_KEY',
    error: '网络错误，请检查网络连接', revision: 3, intervalSeconds: 30, sourcePreference: 'auto',
  },
};

/** Install one jsdom window over the module globals the bundle expects. */
function installDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:3080/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.AbortSignal.timeout ??= AbortSignal.timeout;
  // The component polls on a two-second interval. Taking the timer over makes a
  // transition test deterministic instead of a race against wall-clock time.
  const intervals = [];
  window.setInterval = (callback) => { intervals.push(callback); return intervals.length; };
  window.clearInterval = () => {};
  window.__intervals = intervals;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Image = window.Image;
  globalThis.Audio = window.Audio;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

/**
 * Load the shipped bundle and mount its registered overlay.
 * @param {string} snapshot - key of {@link STATES} the stubbed host answers with.
 * @param {object} [options] - `character` seeds the stored character choice.
 * @returns the mount handle plus the stubbed transport bookkeeping.
 */
async function mount(snapshot, options = {}) {
  const dom = installDom();
  const requests = [];
  let answer = STATES[snapshot];
  if (options.character !== undefined) {
    window.localStorage.setItem('dsh-vk1-pet:v1:character', JSON.stringify(options.character));
  }

  // `api.js` calls the bare global `fetch`, which is `window.fetch` in a browser
  // but Node's own fetch here — stub both so the transport is fully under test.
  const transport = async (url, init = {}) => {
    requests.push({ url: String(url), ...init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, state: answer }),
    };
  };
  globalThis.fetch = transport;
  window.fetch = transport;

  let registration = null;
  window.__ModuleLoader__ = { load: (value) => { registration = value; } };
  const bundleUrl = new URL('../client/client.js', import.meta.url);
  bundleUrl.searchParams.set('t', `${snapshot}-${Date.now()}`);
  await import(bundleUrl.href);

  const moduleExports = registration.factory((specifier) => require(specifier));
  let component = null;
  moduleExports.apply({
    effect: (body) => { body(); return () => {}; },
    slots: {
      inject: (_slot, body) => body(),
      register: (_options, registered) => { component = registered; return () => {}; },
    },
  });
  assert.ok(component !== null, 'the plugin must register an overlay component');

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = require('react-dom/test-utils');
  const container = document.getElementById('root');
  const root = createRoot(container);

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  await act(async () => { root.render(React.createElement(component)); });
  await flush();

  /** Run one poll cycle the way the two-second timer would. */
  const poll = async () => {
    for (const callback of window.__intervals) {
      await act(async () => { callback(); });
    }
    await flush();
  };

  /** Click the first element matching a selector, through React's event system. */
  const click = async (selector, text) => {
    const candidates = [...container.querySelectorAll(selector)];
    const target = text === undefined
      ? candidates[0]
      : candidates.find((node) => node.textContent.trim() === text);
    assert.ok(target !== undefined, `no ${selector} matching ${JSON.stringify(text ?? '<first>')}`);
    await act(async () => {
      target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  /** Let real animation frames run (jsdom drives rAF from a timer). */
  const frames = async (ms = 90) => {
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, ms); }); });
  };

  return {
    dom,
    requests,
    flush,
    poll,
    click,
    frames,
    /** Swap the answer the next poll returns. */
    setState: (next) => { answer = STATES[next]; },
    html: () => container.innerHTML,
    countFloats: () => container.querySelectorAll('.vk1p-float').length,
    unmount: async () => { await act(async () => { root.unmount(); }); dom.window.close(); },
  };
}

test('the whale shows the holding-basin art while the host is still connecting', async () => {
  const view = await mount('connecting');
  try {
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    assert.doesNotMatch(view.html(), /sprite\.png\?/, 'the tablet art must not be painted');
    assert.doesNotMatch(view.html(), /vk1p-tablet/, 'no balance title, amount, or status dot');
    assert.match(view.html(), /¥ --/, 'the pill reports an unknown balance');
  } finally {
    await view.unmount();
  }
});

test('the whale keeps the holding-basin art when no credential is configured', async () => {
  const view = await mount('unconfigured');
  try {
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    assert.doesNotMatch(view.html(), /vk1p-tablet/);
  } finally {
    await view.unmount();
  }
});

test('the whale falls back to the holding-basin art when the poll fails', async () => {
  const view = await mount('failed');
  try {
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    assert.doesNotMatch(view.html(), /vk1p-tablet/);
  } finally {
    await view.unmount();
  }
});

test('the whale returns to the tablet as soon as a reading lands', async () => {
  const view = await mount('connecting');
  try {
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    view.setState('ready');
    await view.poll();
    assert.match(view.html(), /sprite\.png\?/, 'the tablet art is restored');
    assert.match(view.html(), /DSH 余额/, 'the balance readout comes back');
    assert.match(view.html(), /30\.70/);
    assert.doesNotMatch(view.html(), /sprite-deepseek-offline\.png/);
  } finally {
    await view.unmount();
  }
});

test('the whale drops back to the holding-basin art when the connection is lost', async () => {
  const view = await mount('ready');
  try {
    assert.match(view.html(), /sprite\.png\?/);
    view.setState('failed');
    await view.poll();
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    assert.doesNotMatch(view.html(), /vk1p-tablet/);
  } finally {
    await view.unmount();
  }
});

test('the whale also falls back when a reading stops arriving without an error', async () => {
  // `connecting` after a success is what a host restart looks like from the
  // browser: the reading disappears and the basin must come back.
  const view = await mount('ready');
  try {
    assert.match(view.html(), /sprite\.png\?/);
    view.setState('connecting');
    await view.poll();
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
  } finally {
    await view.unmount();
  }
});

test('a guest character keeps its own art and its greyed readout while offline', async () => {
  const view = await mount('failed', { character: 'gemini' });
  try {
    assert.match(view.html(), /sprite-gemini\.png/);
    assert.doesNotMatch(view.html(), /sprite-deepseek-offline\.png/);
    // "其他三个角色保持原有显示方式": only the whale swaps artwork, so a guest
    // keeps its tablet and simply shows the unavailable readout.
    assert.match(view.html(), /vk1p-tablet/);
    assert.match(view.html(), /--/);
  } finally {
    await view.unmount();
  }
});

/**
 * Open the pet's menu and rehearse one deduction.
 * @param view - the mount handle.
 */
async function rehearseOneHit(view) {
  await view.click('.vk1p-pill');
  await view.click('button', '测试一次扣费');
  await view.frames();
}

test('the connected whale does float a rehearsal amount', async () => {
  const view = await mount('ready');
  try {
    await rehearseOneHit(view);
    assert.ok(view.countFloats() > 0, 'a hit on a live reading shows its amount');
  } finally {
    await view.unmount();
  }
});

test('the offline whale hides the floating amounts the desktop build hides', async () => {
  // "不显示余额标题、金额、状态点或金额飘字": with the readout suppressed, a
  // floating "-0.01" would be the only number on screen and would read as a
  // real deduction, so the desktop build suppresses it too.
  const view = await mount('unconfigured');
  try {
    assert.match(view.html(), /sprite-deepseek-offline\.png/);
    await rehearseOneHit(view);
    assert.equal(view.countFloats(), 0, 'no floating amount over the holding-basin art');
    // The hit itself still lands: shake, flash, and sound are not suppressed.
    assert.match(view.html(), /vk1p-flash|vk1p-ring|vk1p-shake/);
  } finally {
    await view.unmount();
  }
});

test('a guest character keeps its floating amounts while offline', async () => {
  const view = await mount('failed', { character: 'gemini' });
  try {
    await rehearseOneHit(view);
    assert.ok(view.countFloats() > 0, 'the other three characters keep their own display');
  } finally {
    await view.unmount();
  }
});
