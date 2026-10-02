import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHARACTERS,
  SIZE_PRESETS,
  SNAP_POSITION,
  TABLET_HEIGHT,
  TABLET_WIDTH,
  assetUrl,
  characterOf,
  fenToString,
  layoutOf,
  releasePosition,
  sizeOf,
  spriteFileFor,
  tabletMatrix,
} from '../client/constants.js';

test('the canvas keeps the desktop pet proportions', () => {
  const layout = layoutOf(150);
  assert.equal(layout.width, 225);
  assert.equal(layout.height, 232.5);
  assert.equal(layout.spriteWidth, 150 * 0.94 * 1.5);
  assert.equal(layout.spriteHeight, 150 * 0.94);
  // The artwork is drawn as a 0.94-scaled body inside a 1.55-tall canvas, so
  // the extra 0.55 above the body stays free for the floating amounts.
  assert.ok(layout.spriteTop > 0);
  assert.ok(layout.spriteTop + layout.spriteHeight <= layout.height);
});

test('the tablet corners map the artwork back to the logical 400x220 panel', () => {
  const corners = { tl: [1060, 699], tr: [1413, 644], bl: [1090, 889] };
  for (const side of [110, 150, 210, 280]) {
    const layout = layoutOf(side);
    const scale = layout.spriteWidth / 1536;
    // The component places the tablet inside the shake layer, whose origin is
    // the sprite box's top-left corner, so the matrix carries no canvas offset.
    const matrix = tabletMatrix({ spriteLeft: 0, spriteTop: 0, scale }, corners);
    const parts = /^matrix\(([^)]+)\)$/.exec(matrix);
    assert.ok(parts !== null, matrix);
    const [a, b, c, d, e, f] = parts[1].split(',').map(Number);

    // The untransformed box's top-left maps onto the measured top-left corner.
    assert.ok(Math.abs(e - corners.tl[0] * scale) < 1e-6);
    assert.ok(Math.abs(f - corners.tl[1] * scale) < 1e-6);
    // The top-right corner is one panel width away.
    assert.ok(Math.abs(a * TABLET_WIDTH + e - corners.tr[0] * scale) < 1e-6);
    assert.ok(Math.abs(b * TABLET_WIDTH + f - corners.tr[1] * scale) < 1e-6);
    // The bottom-left corner is one panel height away.
    assert.ok(Math.abs(c * TABLET_HEIGHT + e - corners.bl[0] * scale) < 1e-6);
    assert.ok(Math.abs(d * TABLET_HEIGHT + f - corners.bl[1] * scale) < 1e-6);
  }
});

test('the Gemini text area is narrower than the shared one', () => {
  const shared = characterOf('deepseek').corners;
  const gemini = characterOf('gemini').corners;
  assert.ok(gemini.tr[0] < shared.tr[0]);
  assert.ok(gemini.tr[1] > shared.tr[1]);
});

test('every character names a sprite that exists in the asset list', () => {
  for (const entry of CHARACTERS) {
    assert.match(entry.file, /^sprite(-[a-z]+)?\.png$/);
    if (entry.offlineFile !== undefined) assert.match(entry.offlineFile, /^sprite-.*\.png$/);
    assert.ok(entry.title.length > 0);
  }
});

test('the whale shows holding-basin art only while it is disconnected', () => {
  const deepseek = characterOf('deepseek');
  assert.equal(spriteFileFor(deepseek, true), 'sprite.png');
  assert.equal(spriteFileFor(deepseek, false), 'sprite-deepseek-offline.png');
  for (const id of ['gpt', 'claude', 'gemini']) {
    const character = characterOf(id);
    assert.equal(spriteFileFor(character, true), character.file);
    assert.equal(spriteFileFor(character, false), character.file, `${id} keeps its own art offline`);
  }
});

test('unknown ids fall back instead of throwing', () => {
  assert.equal(characterOf('nope').id, 'deepseek');
  assert.equal(sizeOf('nope').id, 'medium');
  assert.equal(sizeOf(undefined).side, 150);
});

test('asset URLs are versioned so a rebuilt sprite is not served from cache', () => {
  const url = assetUrl('sprite.png');
  assert.match(url, /^\/dsh-vk1-pet\/assets\/sprite\.png\?v=/);
});

test('size presets mirror the desktop app', () => {
  assert.deepEqual(SIZE_PRESETS.map((entry) => entry.side), [110, 150, 210, 280]);
});

test('fenToString mirrors the host formatting', () => {
  assert.equal(fenToString(3140), '31.40');
  assert.equal(fenToString(-5), '-0.05');
  assert.equal(fenToString(0), '0.00');
  assert.equal(fenToString(null), '--');
  assert.equal(fenToString(Number.NaN), '--');
});

test('releasing a drag stays where the pet was dropped when snapping is off', () => {
  // The regression this guards: the pet starts at the bottom-left corner, so
  // committing the gesture's origin instead of its last position looks exactly
  // like "snapping is still on" even though the preference was turned off.
  const drag = {
    originLeft: SNAP_POSITION.left,
    originBottom: SNAP_POSITION.bottom,
    last: { left: 640, bottom: 320 },
    moved: true,
  };
  assert.deepEqual(releasePosition(drag, false), { left: 640, bottom: 320 });
});

test('releasing a drag snaps to the corner only while the preference is on', () => {
  const drag = { originLeft: 400, originBottom: 200, last: { left: 640, bottom: 320 }, moved: true };
  assert.deepEqual(releasePosition(drag, true), SNAP_POSITION);
  // A hand-placed pet is never moved by turning the preference back on; the
  // next drag is what re-snaps it.
  assert.notEqual(releasePosition(drag, false), SNAP_POSITION);
});

test('a click that never became a drag settles nowhere', () => {
  const pressed = { originLeft: 640, originBottom: 320, last: null, moved: false };
  assert.equal(releasePosition(pressed, true), null, 'a click on a placed pet must not teleport it');
  assert.equal(releasePosition(pressed, false), null);
  assert.equal(releasePosition(null, true), null);
});

test('a drag with no recorded move falls back to the gesture origin', () => {
  // Defensive: if every pointermove were coalesced away, the pet must rest at
  // the last position the pointer handler actually committed.
  const drag = { originLeft: 200, originBottom: 100, last: null, moved: true };
  assert.deepEqual(releasePosition(drag, false), { left: 200, bottom: 100 });
});
