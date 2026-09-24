/**
 * Builds the rendered Understudy hand every frame: the Lead hand reflected
 * across the calibrated midline, blended per finger with the tracked
 * Understudy hand according to its share and its attempt gate.
 */
import { createSystem } from '@iwsdk/core';
import { FingerAttemptDetector, LeadMotion } from '../core/attempt.js';
import { CHAINS, J, newPose, Pose } from '../core/joints.js';
import { v3 } from '../core/math.js';
import { mirrorPose, planeFromPalms } from '../core/mirror.js';
import {
  blendUnderstudy,
  localToPose,
  newLocalPose,
  poseToLocal,
} from '../core/rehearse.js';
import { leadHand, state, understudyHand } from './state.js';

export type AttemptPhase = 'off' | 'calibrating' | 'on';

export class MirrorSystem extends createSystem({}) {
  private readonly mirrored = newPose();
  private readonly lm = newLocalPose();
  private readonly lo = newLocalPose();
  private readonly lr = newLocalPose();
  private readonly out = newLocalPose();
  private readonly lastLead = newPose();
  private hasLead = false;
  readonly fingerDetectors = [0, 1, 2, 3, 4].map(() => new FingerAttemptDetector());
  readonly handDetector = new FingerAttemptDetector();
  private readonly leadMotion = [0, 1, 2, 3, 4].map(() => new LeadMotion());
  private readonly leadHandMotion = new LeadMotion();
  attemptPhase: AttemptPhase = 'off';
  private calibrateLeft = 0;
  /** When true every finger is driven by the mirror regardless of share. */
  forceWatch = true;
  private readonly offsetVec = v3();

  /** Calibrates the midline from both palms and stores the Understudy rest pose. */
  calibrateFromHands(): boolean {
    const lead = state.hands[leadHand()];
    const us = state.hands[understudyHand()];
    if (!lead.valid) return false;
    const up = state.station.up;
    if (us.valid) {
      planeFromPalms(lead.kin.palmCenter, us.kin.palmCenter, up, state.mirror.plane);
      for (let i = 0; i < state.mirror.restPose.length; i++) state.mirror.restPose[i] = us.pose[i];
      state.mirror.hasRest = true;
    } else {
      // no Understudy hand in view: mirror about a plane 20 cm to the side
      const side = understudyHand() === 'left' ? -1 : 1;
      const r = state.station.right;
      const target = v3(
        lead.kin.palmCenter[0] + r[0] * side * 0.36,
        lead.kin.palmCenter[1],
        lead.kin.palmCenter[2] + r[2] * side * 0.36,
      );
      planeFromPalms(lead.kin.palmCenter, target, up, state.mirror.plane);
      mirrorPose(lead.pose, state.mirror.plane, state.mirror.restPose);
      state.mirror.hasRest = false;
    }
    return true;
  }

  /** Places the midline so the mirrored Lead lands on a given point (residual limb). */
  calibrateToPoint(point: Float64Array): boolean {
    const lead = state.hands[leadHand()];
    if (!lead.valid) return false;
    planeFromPalms(lead.kin.palmCenter, point, state.station.up, state.mirror.plane);
    mirrorPose(lead.pose, state.mirror.plane, state.mirror.restPose);
    state.mirror.hasRest = false;
    return true;
  }

  startAttemptCalibration(seconds = 10): void {
    this.attemptPhase = 'calibrating';
    this.calibrateLeft = seconds;
    for (const d of this.fingerDetectors) d.reset();
    this.handDetector.reset();
  }

  update(delta: number): void {
    const m = state.mirror;
    const target = m.active ? 1 : 0;
    m.visibility += (target - m.visibility) * (1 - Math.exp(-delta / 0.25));
    if (!m.active && m.visibility < 0.01) return;

    const lead = state.hands[leadHand()];
    const us = state.hands[understudyHand()];
    if (lead.valid) {
      for (let i = 0; i < this.lastLead.length; i++) this.lastLead[i] = lead.pose[i];
      this.hasLead = true;
    }
    if (!this.hasLead) return;

    mirrorPose(this.lastLead, m.plane, this.mirrored);
    if (m.offset !== 0) {
      const n = m.plane.normal;
      this.offsetVec[0] = n[0] * m.offset;
      this.offsetVec[1] = 0;
      this.offsetVec[2] = n[2] * m.offset;
      offsetPose(this.mirrored, this.offsetVec);
    }

    this.updateAttempts(delta, lead.valid ? lead.kin : null, us.valid ? us.kin : null);

    // gates: whole-hand attempts open every finger; single-finger attempts
    // open that finger (S4: whole-hand attempts are the reliable signal)
    const controls = m.controls;
    for (let f = 0; f < 5; f++) {
      const c = controls[f];
      if (this.forceWatch || this.attemptPhase !== 'on') c.gate = 1;
      else c.gate = Math.max(this.handDetector.gate, this.fingerDetectors[f].gate);
    }

    poseToLocal(this.mirrored, this.lm);
    const own = !this.forceWatch && us.valid ? poseToLocal(us.pose, this.lo) : null;
    const rest = m.hasRest ? poseToLocal(m.restPose, this.lr) : null;
    if (this.forceWatch) {
      const saved = controls.map((c) => c.share);
      controls.forEach((c) => (c.share = 0));
      blendUnderstudy(this.lm, null, rest, controls, this.out);
      controls.forEach((c, i) => (c.share = saved[i]));
    } else {
      blendUnderstudy(this.lm, own, rest, controls, this.out);
    }
    localToPose(this.out, m.renderPose);
  }

  private updateAttempts(dt: number, leadKin: typeof state.hands.left.kin | null, usKin: typeof state.hands.left.kin | null): void {
    if (this.attemptPhase === 'off' || !usKin) return;
    const fingerAngle = (k: typeof usKin, f: number) =>
      f === 0 ? k.thumb.mcp + k.thumb.ip : k.fingers[f - 1].sum;
    const handAngle = (k: typeof usKin) => (k.fingers[0].sum + k.fingers[1].sum + k.fingers[2].sum + k.fingers[3].sum) / 4;
    if (this.attemptPhase === 'calibrating') {
      for (let f = 0; f < 5; f++) this.fingerDetectors[f].calibrate(fingerAngle(usKin, f), dt);
      this.handDetector.calibrate(handAngle(usKin), dt);
      this.calibrateLeft -= dt;
      if (this.calibrateLeft <= 0) {
        for (const d of this.fingerDetectors) d.finishCalibration();
        this.handDetector.finishCalibration();
        this.attemptPhase = 'on';
      }
      return;
    }
    if (leadKin) {
      for (let f = 0; f < 5; f++) this.leadMotion[f].update(fingerAngle(leadKin, f), dt);
      this.leadHandMotion.update(handAngle(leadKin), dt);
    }
    for (let f = 0; f < 5; f++) {
      const lm = this.leadMotion[f];
      this.fingerDetectors[f].update(fingerAngle(usKin, f), dt, lm.velocity, lm.moving);
    }
    this.handDetector.update(handAngle(usKin), dt, this.leadHandMotion.velocity, this.leadHandMotion.moving);
  }

  /** The Understudy hand's index tip under the cloth, where the embodiment check scores touches. */
  hiddenIndexTip(out: Float64Array): Float64Array {
    const pose = state.mirror.hasRest ? state.mirror.restPose : this.mirrored;
    out[0] = pose[J.indexTip * 16 + 12];
    out[1] = pose[J.indexTip * 16 + 13];
    out[2] = pose[J.indexTip * 16 + 14];
    return out;
  }
}

function offsetPose(pose: Pose, d: Float64Array): void {
  for (let j = 0; j < 25; j++) {
    pose[j * 16 + 12] += d[0];
    pose[j * 16 + 13] += d[1];
    pose[j * 16 + 14] += d[2];
  }
}

export { CHAINS };
