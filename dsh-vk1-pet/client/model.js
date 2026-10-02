/**
 * The pet's accounting and animation state machine.
 *
 * Server accounting and animation stay separate on purpose: a menu rehearsal
 * must never consume a real deduction, and an unchanged poll must never look
 * like a top-up. This is a direct port of the macOS build's `PetModel`, with
 * fen as plain integers because every amount here is well inside the safe
 * integer range.
 * @module dsh-vk1-pet/client/model
 */

import { fenToString } from './constants.js';

/** Seconds between two animated one-fen steps. */
export const STEP_INTERVAL = 0.2;
/** Seconds one hit (shake, red flash) lasts. */
export const HIT_DURATION = 0.55;
/** Seconds a floating amount stays on screen. */
export const FLOAT_LIFETIME = 0.95;
/** Seconds the top-up ring animates. */
export const TOPUP_DURATION = 0.9;
/** Largest real deduction animated one fen at a time before snapping. */
export const MAX_PENDING_STEPS = 400;
/** Largest rehearsal queue, including repeated menu clicks. */
export const MAX_DEMO_STEPS = 200;
/** Most floating labels kept on screen at once. */
const MAX_FLOAT_LABELS = 60;

/**
 * Create one model instance.
 * @returns a fresh model.
 */
export function createModel() {
  return {
    /** Last reading the server returned. */
    realFen: null,
    /** Amount the tablet currently shows; trails `realFen` during a hit queue. */
    bookedFen: null,
    /** Queued real deductions, one fen each. */
    pendingSteps: 0,
    /** Queued rehearsal steps. */
    demoRemaining: 0,
    /** How much the rehearsal has subtracted so far. */
    demoOffset: 0,
    /** Countdown before the rehearsal snaps back to the real balance. */
    demoRestoreTime: 0,
    stepCooldown: 0,
    shakeTime: 0,
    flashTime: 0,
    topupTime: 0,
    floating: [],
    nextFloatId: 1,
    /** Increments once per hit so the caller can play the sound effect. */
    hits: 0,
  };
}

/** Drop every queued animation and pin the display to the last reading. */
export function snapToReal(model) {
  model.bookedFen = model.realFen;
  model.pendingSteps = 0;
  model.demoRemaining = 0;
  model.demoOffset = 0;
  model.demoRestoreTime = 0;
  model.stepCooldown = 0;
}

/** Return the model to its unconfigured appearance. */
export function resetModel(model) {
  model.realFen = null;
  model.bookedFen = null;
  snapToReal(model);
  model.floating = [];
  model.shakeTime = 0;
  model.flashTime = 0;
  model.topupTime = 0;
}

/**
 * Add one floating label.
 * @param model - the model.
 * @param text - label text, e.g. `-0.01`.
 * @param tone - `hit` (red) or `topup` (green).
 */
export function pushFloat(model, text, tone) {
  model.floating.push({ id: model.nextFloatId, text, tone, age: 0 });
  model.nextFloatId += 1;
  if (model.floating.length > MAX_FLOAT_LABELS) {
    model.floating.splice(0, model.floating.length - MAX_FLOAT_LABELS);
  }
}

/**
 * Apply one server reading.
 * @param model - the model.
 * @param fen - the reading in fen, or null when the host has no reading.
 * @param options - `snap` discards queued animation (first read, manual refresh).
 * @returns a summary of what the reading meant, for the caller's diagnostics.
 */
export function applyReading(model, fen, options = {}) {
  if (fen === null || fen === undefined || !Number.isFinite(fen)) return { kind: 'none' };

  const previousReal = model.realFen;
  model.realFen = fen;

  if (options.snap === true || model.bookedFen === null || previousReal === null) {
    snapToReal(model);
    return { kind: 'snap' };
  }

  if (fen > previousReal) {
    // A credit is measured between consecutive server readings, never against
    // the lagging animation, so a top-up smaller than the queue still shows.
    const credit = fen - previousReal;
    snapToReal(model);
    model.topupTime = TOPUP_DURATION;
    pushFloat(model, `+${fenToString(credit)}`, 'topup');
    return { kind: 'topup', credit };
  }

  if (fen < model.bookedFen) {
    const steps = model.bookedFen - fen;
    if (steps > MAX_PENDING_STEPS) {
      snapToReal(model);
      return { kind: 'snap-large' };
    }
    // Re-derive the outstanding amount so a repeated poll never replays money
    // already animated, while a fresh deduction extends the queue.
    model.pendingSteps = steps;
    return { kind: 'deduct', steps };
  }

  model.pendingSteps = 0;
  return { kind: 'steady' };
}

/**
 * Queue a rehearsal.
 * @param model - the model.
 * @param times - how many one-fen hits to rehearse.
 */
export function playDemo(model, times) {
  const count = Math.max(1, Math.min(Math.trunc(times) || 1, MAX_DEMO_STEPS));
  model.demoRemaining = Math.min(MAX_DEMO_STEPS, model.demoRemaining + count);
  model.demoRestoreTime = 0;
}

/**
 * Advance the animation by one frame.
 * @param model - the model.
 * @param dt - elapsed seconds since the previous frame.
 * @returns true when this frame produced a hit, so the caller can play the sound.
 */
export function tick(model, dt) {
  if (!Number.isFinite(dt) || dt < 0) return false;
  // A wake from sleep must not produce a burst of hundreds of sounds.
  const elapsed = Math.min(dt, 0.1);

  model.shakeTime = Math.max(0, model.shakeTime - elapsed);
  model.flashTime = Math.max(0, model.flashTime - elapsed);
  model.topupTime = Math.max(0, model.topupTime - elapsed);

  for (const label of model.floating) label.age += elapsed;
  if (model.floating.length > 0) {
    model.floating = model.floating.filter((label) => label.age < FLOAT_LIFETIME);
  }

  if (model.demoRestoreTime > 0) {
    model.demoRestoreTime = Math.max(0, model.demoRestoreTime - elapsed);
    if (model.demoRestoreTime === 0) model.demoOffset = 0;
  }

  if (model.pendingSteps <= 0 && model.demoRemaining <= 0) {
    model.stepCooldown = Math.max(0, model.stepCooldown - elapsed);
    return false;
  }

  model.stepCooldown -= elapsed;
  if (model.stepCooldown > 1e-9) return false;
  // Keep the fractional frame remainder, so on a 60 Hz display a step stays
  // 0.2 s instead of silently stretching to 13 frames.
  model.stepCooldown = Math.max(0, model.stepCooldown + STEP_INTERVAL);

  if (model.pendingSteps > 0 && model.bookedFen !== null && model.realFen !== null && model.bookedFen > model.realFen) {
    model.bookedFen -= 1;
    model.pendingSteps -= 1;
  } else if (model.demoRemaining > 0) {
    model.demoRemaining -= 1;
    model.demoOffset += 1;
    if (model.demoRemaining === 0) model.demoRestoreTime = HIT_DURATION;
  } else {
    model.pendingSteps = 0;
    return false;
  }

  model.shakeTime = HIT_DURATION;
  model.flashTime = HIT_DURATION;
  pushFloat(model, '-0.01', 'hit');
  model.hits += 1;
  return true;
}

/**
 * Whether another animation frame is needed.
 * @param model - the model.
 * @returns true while any animation is live.
 */
export function needsFrame(model) {
  return model.pendingSteps > 0
    || model.demoRemaining > 0
    || model.demoRestoreTime > 0
    || model.floating.length > 0
    || model.shakeTime > 0
    || model.flashTime > 0
    || model.topupTime > 0;
}

/**
 * Amount the tablet shows, including the rehearsal offset.
 * @param model - the model.
 * @returns the displayed fen, or null before the first reading.
 */
export function displayedFen(model) {
  if (model.bookedFen === null) return null;
  const value = model.bookedFen - model.demoOffset;
  // Rehearsals stop visually at zero; a genuine negative balance is preserved.
  return Math.max(Math.min(0, model.bookedFen), value);
}

/**
 * Red-flash strength for the current frame.
 * @param model - the model.
 * @returns 0..1.
 */
export function impact(model) {
  if (model.shakeTime <= 0) return 0;
  const elapsed = HIT_DURATION - model.shakeTime;
  if (elapsed < 0.08) return Math.min(1, elapsed / 0.08);
  return Math.max(0, 1 - (elapsed - 0.08) / (HIT_DURATION - 0.08));
}

/**
 * Hurt-shake offset for the current frame.
 * @param model - the model.
 * @param side - character body height, which scales the amplitude.
 * @returns the translation to apply to the sprite layer.
 */
export function shakeOffset(model, side) {
  if (model.shakeTime <= 0) return { x: 0, y: 0 };
  const elapsed = HIT_DURATION - model.shakeTime;
  const decay = Math.max(0, model.shakeTime / HIT_DURATION);
  const amplitude = Math.min(3.2, side * 0.025);
  return {
    x: Math.sin(elapsed * 24) * amplitude * decay,
    y: Math.cos(elapsed * 19) * amplitude * 0.875 * decay,
  };
}
