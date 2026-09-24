/**
 * Per-finger shared control between the mirror and the Understudy hand.
 *
 * Every finger carries three numbers:
 *  - share (w): how much of the finger's rendered movement is its own, set by
 *    measured recovery and changed only by a real change (see `updateShare`);
 *  - gain (g): amplification of the finger's own movement, decaying to 1 as
 *    the share rises and capped so the render never exceeds twice the real
 *    movement;
 *  - gate: 1 while an attempt is detected on that finger (see attempt.ts), so
 *    in Rehearse the mirror only helps a finger that is trying.
 *
 * Blending happens on joint-local rotations, then forward kinematics rebuilds
 * the pose, so bone lengths are preserved and fingers never stretch.
 */
import { FINGER_COUNT, JOINT_COUNT, JOINT_FINGER, PARENT, Pose } from './joints.js';
import {
  clamp,
  composeMat4,
  getPos,
  q4,
  quatAngle,
  quatConj,
  quatFromMat4,
  quatMul,
  quatRotate,
  quatSlerp,
  RAD,
  sub3,
  v3,
  lerp3,
} from './math.js';

export type Stage = 'watch' | 'rehearse' | 'perform';

export interface LocalPose {
  /** 25 local rotations (root is world), 4 floats each. */
  q: Float64Array;
  /** 25 local offsets from the parent (root is world position), 3 floats each. */
  t: Float64Array;
}

export function newLocalPose(): LocalPose {
  return { q: new Float64Array(JOINT_COUNT * 4), t: new Float64Array(JOINT_COUNT * 3) };
}

const qW = Array.from({ length: JOINT_COUNT }, () => q4());
const pW = Array.from({ length: JOINT_COUNT }, () => v3());
const qa = q4();
const qb = q4();
const qc = q4();
const qInv = q4();
const va = v3();
const vb = v3();

function readQ(l: LocalPose, j: number, out: Float64Array): Float64Array {
  out[0] = l.q[j * 4];
  out[1] = l.q[j * 4 + 1];
  out[2] = l.q[j * 4 + 2];
  out[3] = l.q[j * 4 + 3];
  return out;
}

function writeQ(l: LocalPose, j: number, q: Float64Array): void {
  l.q[j * 4] = q[0];
  l.q[j * 4 + 1] = q[1];
  l.q[j * 4 + 2] = q[2];
  l.q[j * 4 + 3] = q[3];
}

function readT(l: LocalPose, j: number, out: Float64Array): Float64Array {
  out[0] = l.t[j * 3];
  out[1] = l.t[j * 3 + 1];
  out[2] = l.t[j * 3 + 2];
  return out;
}

function writeT(l: LocalPose, j: number, t: Float64Array): void {
  l.t[j * 3] = t[0];
  l.t[j * 3 + 1] = t[1];
  l.t[j * 3 + 2] = t[2];
}

export function poseToLocal(pose: Pose, out: LocalPose): LocalPose {
  for (let j = 0; j < JOINT_COUNT; j++) {
    quatFromMat4(qW[j], pose, j * 16);
    getPos(pW[j], pose, j * 16);
  }
  writeQ(out, 0, qW[0]);
  writeT(out, 0, pW[0]);
  for (let j = 1; j < JOINT_COUNT; j++) {
    const p = PARENT[j];
    quatConj(qInv, qW[p]);
    quatMul(qa, qInv, qW[j]);
    writeQ(out, j, qa);
    sub3(va, pW[j], pW[p]);
    quatRotate(vb, qInv, va);
    writeT(out, j, vb);
  }
  return out;
}

export function localToPose(local: LocalPose, out: Pose): Pose {
  readQ(local, 0, qW[0]);
  readT(local, 0, pW[0]);
  composeMat4(out, pW[0], qW[0], 0);
  for (let j = 1; j < JOINT_COUNT; j++) {
    const p = PARENT[j];
    readQ(local, j, qa);
    quatMul(qW[j], qW[p], qa);
    readT(local, j, va);
    quatRotate(vb, qW[p], va);
    pW[j][0] = pW[p][0] + vb[0];
    pW[j][1] = pW[p][1] + vb[1];
    pW[j][2] = pW[p][2] + vb[2];
    composeMat4(out, pW[j], qW[j], j * 16);
  }
  return out;
}

export interface FingerControl {
  share: number;
  gain: number;
  gate: number;
}

export function newControls(): FingerControl[] {
  return Array.from({ length: FINGER_COUNT }, () => ({ share: 0, gain: 1, gate: 1 }));
}

/** Largest rotation, relative to rest, that amplification may produce at one joint. */
export const MAX_AMPLIFIED_RAD = 105 * RAD;
export const MAX_GAIN = 2;

/**
 * Blends the rendered Understudy hand.
 * `mirror` is the reflected Lead hand, already placed on the Understudy side.
 * `own` is the tracked Understudy hand, or null when it is not tracked.
 * `rest` is the Understudy hand's calibrated rest pose, or null.
 */
export function blendUnderstudy(
  mirror: LocalPose,
  own: LocalPose | null,
  rest: LocalPose | null,
  controls: FingerControl[],
  out: LocalPose,
): LocalPose {
  // mean mirror contribution drives the wrist
  let mSum = 0;
  for (let f = 0; f < FINGER_COUNT; f++) mSum += mirrorContribution(controls[f]);
  const mWrist = own ? mSum / FINGER_COUNT : 1;

  // root
  readQ(mirror, 0, qa);
  readT(mirror, 0, va);
  if (own) {
    readQ(own, 0, qb);
    readT(own, 0, vb);
    quatSlerp(qc, qb, qa, mWrist);
    lerp3(va, vb, va, mWrist);
    writeQ(out, 0, qc);
  } else {
    writeQ(out, 0, qa);
  }
  writeT(out, 0, va);

  for (let j = 1; j < JOINT_COUNT; j++) {
    const f = JOINT_FINGER[j];
    const c = controls[f];
    const m = own ? mirrorContribution(c) : 1;
    readQ(mirror, j, qa);
    if (own) {
      readQ(own, j, qb);
      if (rest && c.gain !== 1) {
        readQ(rest, j, qc);
        const theta = quatAngle(qc, qb);
        const g = theta > 1e-4 ? Math.min(c.gain, MAX_AMPLIFIED_RAD / theta) : 1;
        quatSlerp(qb, qc, qb, Math.max(1, g));
      }
      quatSlerp(qc, qb, qa, m);
      writeQ(out, j, qc);
    } else {
      writeQ(out, j, qa);
    }
    // bone offsets from the Understudy hand's own skeleton when known
    const src = rest ?? own ?? mirror;
    readT(src, j, vb);
    writeT(out, j, vb);
  }
  return out;
}

/** How much of a finger's rendered movement comes from the mirror. */
export function mirrorContribution(c: FingerControl): number {
  return clamp((1 - c.share) * c.gate, 0, 1);
}

export function stageOf(controls: FingerControl[]): Stage {
  let all0 = true;
  let all1 = true;
  for (const c of controls) {
    if (c.share > 0) all0 = false;
    if (c.share < 1) all1 = false;
  }
  return all0 ? 'watch' : all1 ? 'perform' : 'rehearse';
}

/**
 * Share for one finger from its measured range and the same finger on the Lead
 * hand. `floor` is the range below which the finger counts as not moving.
 */
export function shareFromRange(ownRange: number, leadRange: number, floor: number): number {
  if (!(leadRange > floor)) return 0;
  return clamp((ownRange - floor) / (leadRange - floor), 0, 1);
}

/** Amplification gain: the ratio that would make the finger's range match the Lead's, capped. */
export function gainFromRange(ownRange: number, leadRange: number, share: number): number {
  if (share >= 1) return 1;
  if (!(ownRange > 1)) return MAX_GAIN;
  return clamp(leadRange / ownRange, 1, MAX_GAIN);
}

export interface ShareState {
  /** The own range the current share was computed from. */
  anchorRange: number;
  share: number;
}

/**
 * Moves the share only when the finger's range has changed by more than the
 * minimal detectable change since the share was last set. Noise never moves
 * the hand-over.
 */
export function updateShare(
  state: ShareState,
  ownRange: number,
  leadRange: number,
  floor: number,
  mdc: number,
): boolean {
  if (!Number.isFinite(ownRange)) return false;
  if (Number.isFinite(state.anchorRange) && Math.abs(ownRange - state.anchorRange) <= mdc) return false;
  state.anchorRange = ownRange;
  state.share = shareFromRange(ownRange, leadRange, floor);
  return true;
}
