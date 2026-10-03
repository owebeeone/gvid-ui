import { describe, expect, it } from 'vitest';
import { effectsAsCmyka, effectsFromCmyka, evaluateClipEffects, NEUTRAL_EFFECTS,
  validEffects, type SequenceClip } from './index';

describe('clip effects', () => {
  it('holds the base before the first keyframe and interpolates keyed values', () => {
    const clip: SequenceClip = {
      id: 'clip', assetId: 'asset', sourceIn: 10, sourceOut: 50,
      timelineIn: 20, timelineOut: 60,
      effects: { ...NEUTRAL_EFFECTS, alpha: 0.8 },
      keyframes: [
        { id: 'a', sourceFrame: 20, effects: { ...NEUTRAL_EFFECTS, alpha: 0.6, moveX: 20 } },
        { id: 'b', sourceFrame: 40, effects: { ...NEUTRAL_EFFECTS, alpha: 0.2, moveX: 60 } },
      ],
    };
    expect(evaluateClipEffects(clip, 25)).toMatchObject({ alpha: 0.8, moveX: 0 });
    expect(evaluateClipEffects(clip, 30)).toMatchObject({ alpha: 0.6, moveX: 20 });
    expect(evaluateClipEffects(clip, 40)).toMatchObject({ alpha: 0.4, moveX: 40 });
    expect(evaluateClipEffects(clip, 55)).toMatchObject({ alpha: 0.2, moveX: 60 });
  });

  it('switches RGBA and CMYKA views without changing the canonical grade', () => {
    const grade = { ...NEUTRAL_EFFECTS, gradeR: 0.7, gradeG: 0.4, gradeB: 0.2, alpha: 0.5 };
    const view = effectsAsCmyka(grade);
    const restored = effectsFromCmyka(grade, view);
    expect(restored.gradeR).toBeCloseTo(grade.gradeR);
    expect(restored.gradeG).toBeCloseTo(grade.gradeG);
    expect(restored.gradeB).toBeCloseTo(grade.gradeB);
    expect(restored.alpha).toBe(grade.alpha);
    expect(validEffects(restored)).toBe(true);
    expect(validEffects({ ...grade, alpha: Number.NaN })).toBe(false);
    expect(validEffects({ ...grade, scaleX: 0 })).toBe(false);
  });
});
