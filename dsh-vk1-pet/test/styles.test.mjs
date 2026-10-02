/**
 * Theme-safety guard for the injected stylesheet.
 *
 * The reported bug this file exists for: the selected chip hardcoded
 * `color: #fff` on top of `--dsw-alias-brand-primary`, which the DSH theme
 * flips from a near-black blue (light) to `rgb(249, 250, 251)` (dark) — so in
 * dark mode the label rendered white on white. Anything drawn on a theme
 * surface must take BOTH halves from tokens that flip together.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { CLASS, CSS, STYLE_ID } from '../client/styles.js';

/** Comments mention colours; strip them so only real declarations are read. */
const DECLARATIONS_CSS = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** The fixed colours that legitimately mean the same thing on either theme. */
const SEMANTIC_ACCENTS = ['#34c759', '#ff3b30'];

/**
 * Every declaration in the rules keyed by one class.
 * @param selector - class name.
 * @returns `prop → value`, last declaration winning.
 */
function ruleOf(selector) {
  const pattern = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'g');
  const bodies = [...DECLARATIONS_CSS.matchAll(pattern)];
  assert.ok(bodies.length > 0, `no rule for .${selector}`);
  const declarations = {};
  for (const [, body] of bodies) {
    for (const [, prop, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      declarations[prop.trim()] = value.trim();
    }
  }
  return declarations;
}

/** Every `prop: value` pair in the whole stylesheet. */
function allDeclarations() {
  const out = [];
  for (const [, body] of DECLARATIONS_CSS.matchAll(/\{([^}]*)\}/g)) {
    for (const [, prop, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) {
      out.push({ prop: prop.trim(), value: value.trim() });
    }
  }
  return out;
}

/** Whether a value is anchored on a DSH theme token (a fallback after it is fine). */
function isTokenValue(value) {
  return value.startsWith('var(--dsw-');
}

test('the selected chip takes its text from the foreground token that flips with the fill', () => {
  const rule = ruleOf(CLASS.menuChipOn);
  assert.ok(isTokenValue(rule.background), `background was ${rule.background}`);
  assert.ok(rule.background.includes('--dsw-alias-button-primary-fill'));
  // The regression: in the dark theme the brand fill is rgb(249, 250, 251), so
  // the label must come from the token that flips to a dark foreground. The
  // `#fff` here is only the no-theme fallback, never the primary source.
  assert.match(rule.color, /^var\(--dsw-alias-label-primary-foreground/);
});

test('every text colour is anchored on a theme token, or one of the status accents', () => {
  const offenders = allDeclarations()
    .filter(({ prop }) => prop === 'color')
    .filter(({ value }) => !isTokenValue(value) && value !== 'inherit' && !SEMANTIC_ACCENTS.includes(value))
    .map(({ value }) => value);
  assert.deepEqual(offenders, [], 'text colour must come from a --dsw- token, inherit, or a status accent');
});

test('every surface background is anchored on a theme token', () => {
  const offenders = allDeclarations()
    .filter(({ prop }) => prop === 'background' || prop === 'background-color')
    .filter(({ value }) => !isTokenValue(value) && value !== 'transparent')
    .map(({ value }) => value);
  assert.deepEqual(offenders, [], 'a surface must come from a --dsw- token or be transparent');
});

test('the only literal colours left are the two semantic status accents', () => {
  const fixed = new Set();
  for (const { prop, value } of allDeclarations()) {
    if (!/^(color|background|background-color)$/.test(prop)) continue;
    if (isTokenValue(value) || value === 'transparent' || value === 'inherit') continue;
    fixed.add(value);
  }
  // Hit red and top-up green are status accents, not surfaces: they carry the
  // same meaning on either theme, exactly like the macOS build's system colors.
  assert.deepEqual([...fixed].sort(), SEMANTIC_ACCENTS);
});

test('the injected stylesheet keeps its plugin-scoped tag id and covers every class', () => {
  assert.equal(STYLE_ID, 'dsh-vk1-pet/styles');
  assert.match(CSS, /\.vk1p-root\s*\{/);
  const missing = Object.entries(CLASS)
    .filter(([, name]) => !CSS.includes(`.${name}`))
    .map(([key]) => key);
  assert.deepEqual(missing, [], 'every class the component references must have a rule');
});
