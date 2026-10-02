import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLOAT_LIFETIME,
  HIT_DURATION,
  STEP_INTERVAL,
  TOPUP_DURATION,
  applyReading,
  createModel,
  displayedFen,
  needsFrame,
  playDemo,
  resetModel,
  tick,
} from '../client/model.js';

/** Advance the model by whole animation frames. */
function run(model, seconds, frame = 1 / 60) {
  let hits = 0;
  for (let elapsed = 0; elapsed < seconds; elapsed += frame) {
    if (tick(model, frame)) hits += 1;
  }
  return hits;
}

test('the first reading snaps instead of animating history', () => {
  const model = createModel();
  assert.deepEqual(applyReading(model, 3140), { kind: 'snap' });
  assert.equal(displayedFen(model), 3140);
  assert.equal(needsFrame(model), false);
});

test('a deduction animates one fen at a time and plays one hit per step', () => {
  const model = createModel();
  applyReading(model, 1000);
  applyReading(model, 997);
  assert.equal(model.pendingSteps, 3);
  assert.equal(needsFrame(model), true);

  const hits = run(model, 1.0);
  assert.equal(hits, 3);
  assert.equal(displayedFen(model), 997);
  assert.equal(model.pendingSteps, 0);
});

test('a repeated poll of the same balance never replays money already animated', () => {
  const model = createModel();
  applyReading(model, 1000);
  applyReading(model, 998);
  run(model, 0.1); // one step of the two lands
  assert.equal(displayedFen(model), 999);
  applyReading(model, 998);
  assert.equal(model.pendingSteps, 1, 'the queue is re-derived from what is still owed');
  run(model, 0.3);
  assert.equal(displayedFen(model), 998);
});

test('a top-up snaps forward and floats the credit', () => {
  const model = createModel();
  applyReading(model, 1000);
  applyReading(model, 1500);
  assert.equal(displayedFen(model), 1500);
  assert.equal(model.pendingSteps, 0);
  assert.ok(model.topupTime > 0 && model.topupTime <= TOPUP_DURATION);
  assert.equal(model.floating.length, 1);
  assert.equal(model.floating[0].text, '+5.00');
  assert.equal(model.floating[0].tone, 'topup');
});

test('a jump larger than the animation budget snaps instead of queueing', () => {
  const model = createModel();
  applyReading(model, 100_000);
  applyReading(model, 0);
  assert.equal(model.pendingSteps, 0);
  assert.equal(displayedFen(model), 0);
});

test('a rehearsal moves the display without touching the real balance', () => {
  const model = createModel();
  applyReading(model, 500);
  playDemo(model, 3);
  const hits = run(model, 0.5);
  assert.equal(hits, 3);
  assert.equal(displayedFen(model), 497);
  assert.equal(model.realFen, 500, 'the server reading is untouched');
  run(model, HIT_DURATION + 0.1);
  assert.equal(displayedFen(model), 500, 'the display snaps back after the rehearsal');
});

test('a rehearsal never crosses a genuine negative balance', () => {
  const model = createModel();
  applyReading(model, -50);
  playDemo(model, 100);
  run(model, 25);
  assert.equal(displayedFen(model), -50);
});

test('a long sleep does not produce a burst of hits', () => {
  const model = createModel();
  applyReading(model, 1000);
  applyReading(model, 900);
  assert.equal(tick(model, 30), true, 'one frame may still fire on the clamped step');
  assert.equal(model.pendingSteps, 99, 'the clamp keeps a 30 s stall to one 0.1 s frame');
});

test('shaking and floating settle back to an idle model', () => {
  const model = createModel();
  applyReading(model, 100);
  applyReading(model, 99);
  run(model, 2);
  assert.equal(needsFrame(model), false);
  assert.equal(model.shakeTime, 0);
  assert.equal(model.floating.length, 0);
  assert.equal(model.stepCooldown, 0);
});

test('step cadence stays on the 0.2 s grid across uneven frames', () => {
  const model = createModel();
  applyReading(model, 10);
  applyReading(model, 5);
  let hits = 0;
  const frames = [0, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05];
  for (let round = 0; round < 6; round += 1) {
    for (const frame of frames) if (tick(model, frame)) hits += 1;
  }
  assert.equal(hits, 5);
  assert.equal(displayedFen(model), 5);
});

test('float labels expire after their lifetime', () => {
  const model = createModel();
  applyReading(model, 100);
  applyReading(model, 99);
  run(model, FLOAT_LIFETIME + 0.05);
  assert.equal(model.floating.length, 0);
});

test('resetModel returns the unconfigured appearance', () => {
  const model = createModel();
  applyReading(model, 1000);
  resetModel(model);
  assert.equal(displayedFen(model), null);
  assert.equal(needsFrame(model), false);
});

test('a non-finite or missing reading is ignored', () => {
  const model = createModel();
  applyReading(model, 1000);
  assert.deepEqual(applyReading(model, null), { kind: 'none' });
  assert.deepEqual(applyReading(model, Number.NaN), { kind: 'none' });
  assert.equal(displayedFen(model), 1000);
});

test('STEP_INTERVAL governs the number of steps per second', () => {
  const model = createModel();
  applyReading(model, 10);
  applyReading(model, 0);
  // The first step fires on the first frame and each following step keeps the
  // sub-frame remainder, so a second of frames lands six hits, not five: the
  // cadence tracks the 0.2 s grid instead of drifting a frame slower per step.
  const hits = run(model, 1.0);
  assert.equal(hits, 6, `1 s of frames at ${STEP_INTERVAL} s per step`);
});
