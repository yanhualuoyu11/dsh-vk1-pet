/**
 * Emit the exact geometry the browser half uses, so the offline preview
 * renderer draws from the shipped constants instead of a copy of them.
 *
 * Usage: node .verify/preview-geometry.mjs > .verify/geometry.json
 */
import {
  CHARACTERS,
  TABLET_HEIGHT,
  TABLET_WIDTH,
  characterOf,
  layoutOf,
  sizeOf,
  spriteFileFor,
  tabletMatrix,
} from '../dsh-vk1-pet/client/constants.js';
import { HIT_DURATION, shakeOffset } from '../dsh-vk1-pet/client/model.js';

/** One frame per scenario the preview should draw. */
const SCENARIOS = [
  { id: 'connected-medium', character: 'deepseek', size: 'medium', connected: true, balance: '30.70' },
  { id: 'hit-medium', character: 'deepseek', size: 'medium', connected: true, balance: '30.69', impact: 0.45, float: '-0.01', floatProgress: 0.35, shakeTime: HIT_DURATION * 0.64 },
  { id: 'topup-medium', character: 'deepseek', size: 'medium', connected: true, balance: '50.70', topupProgress: 0.3 },
  { id: 'offline-medium', character: 'deepseek', size: 'medium', connected: false, balance: null },
  { id: 'gemini-large', character: 'gemini', size: 'large', connected: true, balance: '30.70' },
  { id: 'gpt-huge', character: 'gpt', size: 'huge', connected: true, balance: '1234.56' },
  { id: 'claude-small', character: 'claude', size: 'small', connected: true, balance: '8.00' },
];

const frames = SCENARIOS.map((scenario) => {
  const character = characterOf(scenario.character);
  const side = sizeOf(scenario.size).side;
  const layout = layoutOf(side);
  const matrix = tabletMatrix({ spriteLeft: 0, spriteTop: 0, scale: layout.scale }, character.corners);
  const [a, b, c, d, e, f] = /^matrix\(([^)]+)\)$/.exec(matrix)[1].split(',').map(Number);
  const shake = scenario.shakeTime === undefined
    ? { x: 0, y: 0 }
    : shakeOffset({ shakeTime: scenario.shakeTime }, side);
  return {
    ...scenario,
    side,
    shake,
    character: { id: character.id, title: character.title },
    sprite: spriteFileFor(character, scenario.connected),
    layout,
    matrix: { a, b, c, d, e, f },
    panel: {
      width: TABLET_WIDTH,
      height: TABLET_HEIGHT,
      title: { text: 'DSH 余额', centerY: TABLET_HEIGHT * 0.2, fontSize: TABLET_HEIGHT * 0.21 },
      amount: {
        centerY: TABLET_HEIGHT * 0.68,
        currencyFontSize: TABLET_HEIGHT * 0.27,
        numberFontSize: TABLET_HEIGHT * 0.48,
        maxWidth: TABLET_WIDTH * 0.9,
      },
      dot: { left: TABLET_WIDTH * 0.92, top: TABLET_HEIGHT * 0.23 - 15, size: 15 },
    },
    colors: {
      title: [158, 184, 227],
      amountOn: [240, 247, 255],
      amountOff: [173, 186, 207],
      dotOn: [52, 199, 89],
      dotOff: [255, 204, 0],
      dotError: [255, 59, 48],
      flash: [255, 26, 36],
      hit: [255, 59, 48],
      topup: [52, 199, 89],
    },
  };
});

process.stdout.write(`${JSON.stringify({ characters: CHARACTERS.map(({ id, title, file, offlineFile }) => ({ id, title, file, offlineFile })), frames }, null, 2)}\n`);
