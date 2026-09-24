import { describe, expect, it } from 'vitest';
import { computeKinematics, kapandjiScore, newKinematics } from '../src/core/kinematics.js';
import { q4, quatAxisAngle, rng, v3, RAD } from '../src/core/math.js';
import {
  buildPose,
  fistAngles,
  neutralAngles,
  openAngles,
  restAngles,
} from '../src/sim/handmodel.js';
import type { Handedness } from '../src/core/joints.js';

const shape = { length: 0.19 };

function placement(yawDeg = 0, rollDeg = 0) {
  const q = q4();
  const qy = quatAxisAngle(q4(), v3(0, 1, 0), yawDeg * RAD);
  const qz = quatAxisAngle(q4(), v3(0, 0, 1), rollDeg * RAD);
  q[0] = qy[0];
  q[1] = qy[1];
  q[2] = qy[2];
  q[3] = qy[3];
  // roll then yaw
  const out = q4();
  const ax = qy;
  const bx = qz;
  out[0] = ax[0] * bx[3] + ax[3] * bx[0] + ax[1] * bx[2] - ax[2] * bx[1];
  out[1] = ax[1] * bx[3] + ax[3] * bx[1] + ax[2] * bx[0] - ax[0] * bx[2];
  out[2] = ax[2] * bx[3] + ax[3] * bx[2] + ax[0] * bx[1] - ax[1] * bx[0];
  out[3] = ax[3] * bx[3] - ax[0] * bx[0] - ax[1] * bx[1] - ax[2] * bx[2];
  return { position: v3(0.1, 0.75, -0.3), orientation: out };
}

describe('S1 kinematics recover ground-truth angles', () => {
  for (const hand of ['left', 'right'] as Handedness[]) {
    it(`finger flexion and abduction, ${hand} hand, random poses and orientations`, () => {
      const r = rng(hand === 'left' ? 11 : 12);
      const k = newKinematics(hand);
      let worst = 0;
      for (let n = 0; n < 500; n++) {
        const a = neutralAngles();
        a.fingers.forEach((f) => {
          f.mcpFlex = -20 + r() * 110;
          f.mcpAbd = f.mcpFlex < 50 ? -15 + r() * 30 : 0;
          f.pipFlex = r() * 105;
          f.dipFlex = -5 + r() * 80;
        });
        a.thumb = { cmcFlex: r() * 40, cmcAbd: r() * 40, mcpFlex: r() * 55, ipFlex: r() * 75 };
        const pose = buildPose(a, hand, shape, placement(r() * 360, -20 + r() * 40));
        computeKinematics(pose, hand, k);
        expect(k.valid).toBe(true);
        a.fingers.forEach((f, i) => {
          const fk = k.fingers[i];
          worst = Math.max(worst, Math.abs(fk.mcp - f.mcpFlex), Math.abs(fk.pip - f.pipFlex), Math.abs(fk.dip - f.dipFlex));
          // abduction is read about each finger's own metacarpal axis, so it is exact
          if (f.mcpAbd !== 0) expect(Math.abs(fk.abd - f.mcpAbd)).toBeLessThan(0.05);
        });
        expect(Math.abs(k.thumb.mcp - a.thumb.mcpFlex)).toBeLessThan(0.1);
        expect(Math.abs(k.thumb.ip - a.thumb.ipFlex)).toBeLessThan(0.1);
      }
      // PIP and DIP are read about the abducted hinge axis, so recovery is exact
      expect(worst).toBeLessThan(0.1);
    });
  }

  it('hand length matches the anatomical model', () => {
    const k = newKinematics('right');
    computeKinematics(buildPose(neutralAngles(), 'right', shape, placement()), 'right', k);
    expect(k.handLength).toBeGreaterThan(0.17);
    expect(k.handLength).toBeLessThan(0.2);
  });

  it('opening, spread and Kapandji behave across fist, rest and open', () => {
    const k = newKinematics('right');
    computeKinematics(buildPose(fistAngles(), 'right', shape, placement()), 'right', k);
    const fistOpening = k.opening;
    computeKinematics(buildPose(restAngles(), 'right', shape, placement()), 'right', k);
    const restOpening = k.opening;
    computeKinematics(buildPose(openAngles(), 'right', shape, placement()), 'right', k);
    expect(k.opening).toBeGreaterThan(restOpening);
    expect(restOpening).toBeGreaterThan(fistOpening);
    expect(k.spread).toBeGreaterThan(25);
    expect(kapandjiScore(k)).toBe(0);
  });
});
