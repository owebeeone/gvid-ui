import type { ClipEffectsState, SequenceClip } from './index';

export const NEUTRAL_EFFECTS: Readonly<ClipEffectsState> = Object.freeze({
  alpha: 1, gradeR: 1, gradeG: 1, gradeB: 1,
  moveX: 0, moveY: 0, scaleX: 1, scaleY: 1, rotateDeg: 0,
});

export function validEffects(value: ClipEffectsState): boolean {
  return value !== null && typeof value === 'object' &&
    Number.isFinite(value.alpha) && value.alpha >= 0 && value.alpha <= 1 &&
    [value.gradeR, value.gradeG, value.gradeB].every((item) =>
      Number.isFinite(item) && item >= 0 && item <= 1) &&
    [value.moveX, value.moveY].every((item) =>
      Number.isFinite(item) && item >= -4096 && item <= 4096) &&
    [value.scaleX, value.scaleY].every((item) =>
      Number.isFinite(item) && item > 0 && item <= 4) &&
    Number.isFinite(value.rotateDeg) && value.rotateDeg >= -3600 && value.rotateDeg <= 3600;
}

export function sameEffects(a: ClipEffectsState, b: ClipEffectsState): boolean {
  return a.alpha === b.alpha && a.gradeR === b.gradeR && a.gradeG === b.gradeG &&
    a.gradeB === b.gradeB && a.moveX === b.moveX && a.moveY === b.moveY &&
    a.scaleX === b.scaleX && a.scaleY === b.scaleY && a.rotateDeg === b.rotateDeg;
}

function mix(a: ClipEffectsState, b: ClipEffectsState, t: number): ClipEffectsState {
  return {
    alpha: a.alpha + (b.alpha - a.alpha) * t,
    gradeR: a.gradeR + (b.gradeR - a.gradeR) * t,
    gradeG: a.gradeG + (b.gradeG - a.gradeG) * t,
    gradeB: a.gradeB + (b.gradeB - a.gradeB) * t,
    moveX: a.moveX + (b.moveX - a.moveX) * t,
    moveY: a.moveY + (b.moveY - a.moveY) * t,
    scaleX: a.scaleX + (b.scaleX - a.scaleX) * t,
    scaleY: a.scaleY + (b.scaleY - a.scaleY) * t,
    rotateDeg: a.rotateDeg + (b.rotateDeg - a.rotateDeg) * t,
  };
}

export function evaluateClipEffects(clip: SequenceClip, timelineFrame: number): ClipEffectsState {
  const base = clip.effects ?? NEUTRAL_EFFECTS;
  const sourceFrame = clip.sourceIn + timelineFrame - clip.timelineIn;
  const keyframes = (clip.keyframes ?? []).filter((item) =>
    item.sourceFrame >= clip.sourceIn && item.sourceFrame < clip.sourceOut)
    .sort((a, b) => a.sourceFrame - b.sourceFrame);
  let previous: typeof keyframes[number] | null = null;
  for (const current of keyframes) {
    if (current.sourceFrame === sourceFrame) return current.effects ?? base;
    if (sourceFrame < current.sourceFrame) {
      return previous ? mix(previous.effects ?? base, current.effects ?? base,
        (sourceFrame - previous.sourceFrame) / (current.sourceFrame - previous.sourceFrame)) : base;
    }
    previous = current;
  }
  return previous?.effects ?? base;
}

export interface Cmyka { c: number; m: number; y: number; k: number; a: number; }

export function effectsAsCmyka(effects: ClipEffectsState): Cmyka {
  const k = 1 - Math.max(effects.gradeR, effects.gradeG, effects.gradeB);
  const remaining = 1 - k;
  return {
    c: remaining === 0 ? 0 : (remaining - effects.gradeR) / remaining,
    m: remaining === 0 ? 0 : (remaining - effects.gradeG) / remaining,
    y: remaining === 0 ? 0 : (remaining - effects.gradeB) / remaining,
    k, a: effects.alpha,
  };
}

export function effectsFromCmyka(effects: ClipEffectsState, value: Cmyka): ClipEffectsState {
  return {
    ...effects,
    gradeR: (1 - value.c) * (1 - value.k),
    gradeG: (1 - value.m) * (1 - value.k),
    gradeB: (1 - value.y) * (1 - value.k),
    alpha: value.a,
  };
}
