/**
 * Client-side constants: character art, size presets, and the geometry that
 * maps the balance readout onto each character's tilted tablet.
 *
 * The geometry is a direct port of the macOS build's `PetLayout`: a `side` is
 * the character's body height in CSS pixels, the canvas adds a `0.55 * side`
 * band above it for the floating amounts, and the sprite is drawn in a
 * `0.94 * side` box centred horizontally — so adding the whale tail does not
 * shrink the face or the tablet.
 * @module dsh-vk1-pet/client/constants
 */

/** URL prefix owned by the host half. */
export const BASE_PATH = '/dsh-vk1-pet';

/** Size of the logical tablet rect each character's corners are measured in. */
export const TABLET_WIDTH = 400;
export const TABLET_HEIGHT = 220;

/** Artwork source size shared by all five PNGs. */
export const ARTWORK_WIDTH = 1536;
export const ARTWORK_HEIGHT = 1024;

/** The four selectable characters plus the whale's offline holding-basin art. */
export const CHARACTERS = [
  {
    id: 'deepseek',
    title: '蓝色大肥鱼',
    file: 'sprite.png',
    offlineFile: 'sprite-deepseek-offline.png',
    corners: { tl: [1060, 699], tr: [1413, 644], bl: [1090, 889] },
  },
  {
    id: 'gpt',
    title: 'GPT龙娘',
    file: 'sprite-gpt.png',
    corners: { tl: [1060, 699], tr: [1413, 644], bl: [1090, 889] },
  },
  {
    id: 'claude',
    title: '大小姐Claude',
    file: 'sprite-claude.png',
    corners: { tl: [1060, 699], tr: [1413, 644], bl: [1090, 889] },
  },
  {
    id: 'gemini',
    title: '北美猫娘Gemini',
    // Gemini's right fingers reach farther into the screen, so the text safe
    // area is narrower to clear them.
    file: 'sprite-gemini.png',
    corners: { tl: [1065, 699], tr: [1400, 646], bl: [1095, 889] },
  },
];

/** Body-height presets, mirroring the desktop app's 小/中/大/特大. */
export const SIZE_PRESETS = [
  { id: 'small', title: '小', side: 110 },
  { id: 'medium', title: '中', side: 150 },
  { id: 'large', title: '大', side: 210 },
  { id: 'huge', title: '特大', side: 280 },
];

/** Poll-interval choices offered by the menu, in seconds. */
export const INTERVAL_CHOICES = [10, 30, 60, 300];

/** Where the pet sits on a first run, after a snap, or from the menu command. */
export const SNAP_POSITION = { left: 12, bottom: 12 };

/**
 * Where the pet settles when the pointer is released.
 *
 * This is the single decision point for 「松手吸附左下角」: with it on the pet
 * returns to the corner, with it off it stays exactly where it was dropped. A
 * press that never became a drag settles nowhere, so a plain click can never
 * teleport a hand-placed pet.
 * @param drag - the live drag record, or null.
 * @param snapOnRelease - the current preference.
 * @returns the position to commit, or null when the gesture was a click.
 */
export function releasePosition(drag, snapOnRelease) {
  if (drag === null || drag === undefined || drag.moved !== true) return null;
  if (snapOnRelease) return SNAP_POSITION;
  // `last` is the position of the most recent pointermove. Falling back to the
  // gesture's origin would silently re-implement snapping whenever a move was
  // throttled away, which is the bug this helper exists to prevent.
  return drag.last ?? { left: drag.originLeft, bottom: drag.originBottom };
}

/** Credential-source choices offered by the menu. */
export const SOURCE_CHOICES = [
  { id: 'auto', title: '自动' },
  { id: 'api-key', title: 'API Key' },
  { id: 'account', title: 'DSH 账号' },
];

/** Find a character by id, falling back to the whale. */
export function characterOf(id) {
  return CHARACTERS.find((entry) => entry.id === id) ?? CHARACTERS[0];
}

/** Find a size preset by id, falling back to the medium preset. */
export function sizeOf(id) {
  return SIZE_PRESETS.find((entry) => entry.id === id) ?? SIZE_PRESETS[1];
}

/**
 * Which artwork one character shows for a connection state.
 *
 * Only the whale owns a holding-basin drawing; the three guest characters keep
 * their own art and simply grey their readout while the host is offline.
 * @param character - the selected character.
 * @param connected - whether the host has a live balance reading.
 * @returns the asset file name.
 */
export function spriteFileFor(character, connected) {
  return character.id === 'deepseek' && !connected ? character.offlineFile : character.file;
}

/**
 * Compute every box the pet canvas needs for one body height.
 * @param side - character body height in CSS pixels.
 * @returns absolute boxes inside the canvas, with a top-left origin.
 */
export function layoutOf(side) {
  const width = side * 1.5;
  const height = side * 1.55;
  const spriteWidth = side * 0.94 * 1.5;
  const spriteHeight = side * 0.94;
  const spriteLeft = (width - spriteWidth) / 2;
  const spriteTop = height - side * 0.03 - spriteHeight;
  return {
    side,
    width,
    height,
    spriteWidth,
    spriteHeight,
    spriteLeft,
    spriteTop,
    scale: spriteWidth / ARTWORK_WIDTH,
  };
}

/**
 * Build the CSS transform that maps the logical 400×220 tablet onto the
 * painted tablet of one character.
 *
 * `matrix(a, b, c, d, e, f)` maps a point of the untransformed box
 * `(u, v)` to `(a·u + c·v + e, b·u + d·v + f)`, which is exactly the affine
 * map sending the tablet rect's top-left, top-right, and bottom-left corners
 * to the measured artwork corners.
 * @param layout - the canvas boxes from {@link layoutOf}.
 * @param corners - the character's measured corners, in artwork pixels.
 * @returns a CSS `matrix(...)` value.
 */
export function tabletMatrix(layout, corners) {
  const { spriteLeft, spriteTop, scale } = layout;
  const [tlx, tly] = corners.tl;
  const [trx, trY] = corners.tr;
  const [blx, bly] = corners.bl;
  const a = ((trx - tlx) / TABLET_WIDTH) * scale;
  const b = ((trY - tly) / TABLET_WIDTH) * scale;
  const c = ((blx - tlx) / TABLET_HEIGHT) * scale;
  const d = ((bly - tly) / TABLET_HEIGHT) * scale;
  const e = spriteLeft + tlx * scale;
  const f = spriteTop + tly * scale;
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
}

/**
 * Absolute URL of one host-served asset.
 * @param name - file name under the plugin's asset route.
 * @returns the URL the browser fetches.
 */
export function assetUrl(name) {
  const version = typeof __DSH_VK1_PET_VERSION__ === 'string' ? __DSH_VK1_PET_VERSION__ : '0';
  return `${BASE_PATH}/assets/${name}?v=${encodeURIComponent(version)}`;
}

/** Format fen as the fixed two-decimal string the tablet shows. */
export function fenToString(fen) {
  if (fen === null || fen === undefined || !Number.isFinite(fen)) return '--';
  const negative = fen < 0;
  const magnitude = Math.abs(Math.round(fen));
  const fraction = magnitude % 100;
  return `${negative ? '-' : ''}${Math.floor(magnitude / 100)}.${String(fraction).padStart(2, '0')}`;
}
