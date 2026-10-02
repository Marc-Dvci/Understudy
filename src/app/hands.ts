/**
 * Reads both hands' 25 joints from WebXR every frame into world space,
 * computes kinematics and marks implausible frames invalid.
 */
import { createSystem } from '@iwsdk/core';
import { Handedness, J, JOINT_COUNT, PARENT, POSE_FLOATS } from '../core/joints.js';
import { computeKinematics } from '../core/kinematics.js';
import { dist3, getPos, mulMat4, v3 } from '../core/math.js';
import { state, TrackedHand } from './state.js';

const MAX_WRIST_SPEED = 4; // m/s; faster jumps are tracking glitches
const BONE_TOLERANCE = 0.15;
const CALIBRATION_FRAMES = 45;
const RELEARN_AFTER = 1; // seconds of rejected skeletons before bone lengths are learnt again

export class HandInputSystem extends createSystem({}) {
  private readonly raw = new Float32Array(POSE_FLOATS);
  private readonly spaces = new Map<XRInputSource, XRSpace[]>();
  private readonly prevWrist = { left: v3(), right: v3() };
  private readonly prevTip = { left: v3(), right: v3() };
  private readonly tmp = v3();
  private readonly seen = { left: false, right: false };
  private readonly rejected = { left: 0, right: 0 };

  update(delta: number, time: number): void {
    state.time = time;
    const frame = this.world.renderer.xr.getFrame() as XRFrame | null;
    const ref = this.world.renderer.xr.getReferenceSpace();
    const session = this.world.session;
    this.seen.left = false;
    this.seen.right = false;

    // head pose for layout decisions
    const head = this.player.head;
    head.updateWorldMatrix(true, false);
    const e = head.matrixWorld.elements;
    state.head[0] = e[12];
    state.head[1] = e[13];
    state.head[2] = e[14];
    const fx = -e[8];
    const fz = -e[10];
    const fl = Math.hypot(fx, fz) || 1;
    state.headForward[0] = fx / fl;
    state.headForward[1] = 0;
    state.headForward[2] = fz / fl;

    if (frame && ref && session) {
      this.player.updateWorldMatrix(true, false);
      const pm = this.player.matrixWorld.elements;
      let controllers = false;
      for (const source of session.inputSources) {
        if (!source.hand && source.gamepad && (source.handedness === 'left' || source.handedness === 'right')) controllers = true;
        if (!source.hand || (source.handedness !== 'left' && source.handedness !== 'right')) continue;
        let spaces = this.spaces.get(source);
        if (!spaces) {
          spaces = Array.from(source.hand.values());
          this.spaces.set(source, spaces);
        }
        if (spaces.length !== JOINT_COUNT) continue;
        const ok = (frame as XRFrame & { fillPoses?: (s: XRSpace[], b: XRSpace, t: Float32Array) => boolean }).fillPoses?.(spaces, ref, this.raw) ?? false;
        const hand = state.hands[source.handedness];
        if (!ok) continue;
        for (let j = 0; j < JOINT_COUNT; j++) mulMat4(hand.pose, pm, this.raw, j * 16, 0, j * 16);
        this.seen[source.handedness] = true;
      }
      state.controllers = controllers;
    }

    for (const h of ['left', 'right'] as Handedness[]) this.finish(state.hands[h], this.seen[h], delta);
  }

  private finish(hand: TrackedHand, seen: boolean, dt: number): void {
    if (!seen) {
      hand.valid = false;
      hand.lostFor += dt;
      return;
    }
    const wrist = getPos(this.tmp, hand.pose, 0);
    const prev = this.prevWrist[hand.handedness];
    const speed = hand.lostFor === 0 && dt > 0 ? dist3(wrist, prev) / dt : 0;
    prev[0] = wrist[0];
    prev[1] = wrist[1];
    prev[2] = wrist[2];

    let plausible = speed < MAX_WRIST_SPEED;
    // bone lengths: learn them, then reject frames that stretch a finger
    if (plausible) {
      let bad = 0;
      for (let j = 1; j < JOINT_COUNT; j++) {
        const p = PARENT[j];
        const len = Math.hypot(
          hand.pose[j * 16 + 12] - hand.pose[p * 16 + 12],
          hand.pose[j * 16 + 13] - hand.pose[p * 16 + 13],
          hand.pose[j * 16 + 14] - hand.pose[p * 16 + 14],
        );
        if (hand.boneSamples < CALIBRATION_FRAMES) {
          hand.boneLengths[j] += (len - hand.boneLengths[j]) / (hand.boneSamples + 1);
        } else if (Math.abs(len - hand.boneLengths[j]) > BONE_TOLERANCE * hand.boneLengths[j] + 0.002) {
          bad++;
        }
      }
      if (hand.boneSamples < CALIBRATION_FRAMES) hand.boneSamples++;
      if (bad > 3) plausible = false;
      // a skeleton that disagrees for a whole second is a new hand scale (the
      // runtime refines it in the first seconds), not a glitch: learn it again
      this.rejected[hand.handedness] = bad > 3 ? this.rejected[hand.handedness] + dt : 0;
      if (this.rejected[hand.handedness] > RELEARN_AFTER) {
        this.rejected[hand.handedness] = 0;
        hand.boneSamples = 0;
        hand.boneLengths.fill(0);
      }
    }

    computeKinematics(hand.pose, hand.handedness, hand.kin);
    hand.valid = plausible && hand.kin.valid;
    hand.lostFor = hand.valid ? 0 : hand.lostFor + dt;
    getPos(hand.indexTip, hand.pose, J.indexTip * 16);
    getPos(hand.thumbTip, hand.pose, J.thumbTip * 16);
    const pt = this.prevTip[hand.handedness];
    hand.indexTipSpeed = dt > 0 ? dist3(hand.indexTip, pt) / dt : 0;
    pt[0] = hand.indexTip[0];
    pt[1] = hand.indexTip[1];
    pt[2] = hand.indexTip[2];
  }
}
