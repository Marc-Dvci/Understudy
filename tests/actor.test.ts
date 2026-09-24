import { describe, expect, it } from 'vitest';
import { J } from '../src/core/joints.js';
import { q4, v3 } from '../src/core/math.js';
import { thumbToFinger } from '../src/sim/actor.js';
import { buildPose } from '../src/sim/handmodel.js';

describe('scripted thumb touches', () => {
  for (const hand of ['left', 'right'] as const) {
    it(`${hand} thumb reaches every fingertip within 1.5 cm`, () => {
      for (let f = 0; f < 4; f++) {
        const p = buildPose(thumbToFinger(hand, f), hand, { length: 0.19 }, { position: v3(), orientation: q4() });
        const t = [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip][f];
        const d = Math.hypot(p[t * 16 + 12] - p[J.thumbTip * 16 + 12], p[t * 16 + 13] - p[J.thumbTip * 16 + 13], p[t * 16 + 14] - p[J.thumbTip * 16 + 14]);
        expect(d).toBeLessThan(0.015);
      }
    });
  }
});
