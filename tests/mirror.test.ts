import { describe, expect, it } from 'vitest';
import { newPose, POSE_FLOATS } from '../src/core/joints.js';
import { mirrorPose, newPlane, planeFromPalms, reflectPoint } from '../src/core/mirror.js';
import { q4, quatAxisAngle, quatMul, rng, v3, RAD } from '../src/core/math.js';
import {
  blendUnderstudy,
  localToPose,
  newControls,
  newLocalPose,
  poseToLocal,
  updateShare,
} from '../src/core/rehearse.js';
import { buildPose, neutralAngles, restAngles, fistAngles } from '../src/sim/handmodel.js';

const shape = { length: 0.19 };

function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < POSE_FLOATS; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function randomAngles(r: () => number) {
  const a = neutralAngles();
  a.fingers.forEach((f) => {
    f.mcpFlex = -15 + r() * 100;
    f.mcpAbd = -10 + r() * 20;
    f.pipFlex = r() * 100;
    f.dipFlex = r() * 70;
  });
  a.thumb = { cmcFlex: r() * 40, cmcAbd: r() * 40, mcpFlex: r() * 50, ipFlex: r() * 70 };
  return a;
}

describe('S10 mirror fidelity', () => {
  it('a mirrored right hand equals an independently built left hand', () => {
    const r = rng(7);
    const plane = newPlane();
    plane.origin[0] = 0.02;
    plane.normal[0] = 1;
    let worst = 0;
    for (let n = 0; n < 300; n++) {
      const angles = randomAngles(r);
      const yaw = quatAxisAngle(q4(), v3(0, 1, 0), (r() * 60 - 30) * RAD);
      const roll = quatAxisAngle(q4(), v3(0, 0, 1), (r() * 30 - 15) * RAD);
      const q = quatMul(q4(), yaw, roll);
      const p = v3(-0.15 - r() * 0.1, 0.74, -0.35 - r() * 0.1);
      const right = buildPose(angles, 'right', shape, { position: p, orientation: q });
      // ground-truth placement of the mirror image across the plane x = 0.02
      const pm = reflectPoint(v3(), p, plane);
      const qm = q4(q[0], -q[1], -q[2], q[3]);
      const left = buildPose(angles, 'left', shape, { position: pm, orientation: qm });
      const mirrored = mirrorPose(right, plane, newPose());
      worst = Math.max(worst, maxDiff(mirrored, left));
    }
    // float32 storage bounds the agreement
    expect(worst).toBeLessThan(2e-6);
  });

  it('the palm bisector reflects one resting palm onto the other', () => {
    const plane = planeFromPalms(v3(-0.2, 0.75, -0.4), v3(0.18, 0.75, -0.38), v3(0, 1, 0), newPlane());
    const out = reflectPoint(v3(), v3(-0.2, 0.75, -0.4), plane);
    expect(Math.hypot(out[0] - 0.18, out[1] - 0.75, out[2] + 0.38)).toBeLessThan(1e-9);
  });
});

describe('local decomposition and blending', () => {
  const place = { position: v3(0.2, 0.75, -0.4), orientation: q4() };
  const mirrorP = buildPose(fistAngles(), 'left', shape, place);
  const ownP = buildPose(restAngles(), 'left', shape, place);

  it('forward kinematics reproduces the pose', () => {
    const l = poseToLocal(mirrorP, newLocalPose());
    expect(maxDiff(localToPose(l, newPose()), mirrorP)).toBeLessThan(2e-6);
  });

  it('Watch renders the mirror, Perform renders the own hand', () => {
    const lm = poseToLocal(mirrorP, newLocalPose());
    const lo = poseToLocal(ownP, newLocalPose());
    const c = newControls();
    const out = newLocalPose();
    blendUnderstudy(lm, lo, lo, c, out);
    expect(maxDiff(localToPose(out, newPose()), mirrorP)).toBeLessThan(2e-6);
    c.forEach((f) => {
      f.share = 1;
      f.gain = 1;
    });
    blendUnderstudy(lm, lo, lo, c, out);
    expect(maxDiff(localToPose(out, newPose()), ownP)).toBeLessThan(2e-6);
  });

  it('an untracked Understudy hand falls back to the mirror', () => {
    const lm = poseToLocal(mirrorP, newLocalPose());
    const c = newControls();
    c.forEach((f) => (f.share = 0.6));
    const out = blendUnderstudy(lm, null, null, c, newLocalPose());
    expect(maxDiff(localToPose(out, newPose()), mirrorP)).toBeLessThan(2e-6);
  });

  it('the share moves only on a change above the MDC', () => {
    const s = { anchorRange: NaN, share: 0 };
    expect(updateShare(s, 60, 240, 20, 12)).toBe(true);
    const first = s.share;
    expect(updateShare(s, 70, 240, 20, 12)).toBe(false);
    expect(s.share).toBe(first);
    expect(updateShare(s, 80, 240, 20, 12)).toBe(true);
    expect(s.share).toBeGreaterThan(first);
  });
});
