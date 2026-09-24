/**
 * Runs the app's measurement protocols on a synthetic hand, through the same
 * chain the headset uses: angles -> tracker error -> 25-joint pose ->
 * kinematics -> trial buffers -> session values.
 */
import { Handedness, newPose } from '../core/joints.js';
import { computeKinematics, newKinematics } from '../core/kinematics.js';
import {
  analyseTapping,
  fitWarmup,
  handPrintFromTrials,
  HandPrint,
  robustPeak,
  sessionValue,
  TrialBuffer,
} from '../core/measure.js';
import { q4, v3 } from '../core/math.js';
import { buildPose, fistAngles, neutralAngles, openAngles } from './handmodel.js';
import { TrackerNoise } from './noise.js';
import { achievedPose, PatientParams, patientRest, trialFrames } from './patient.js';

export const FPS = 72;
const SHAPE = { length: 0.19 };

function placement(hand: Handedness) {
  return { position: v3(hand === 'left' ? -0.16 : 0.16, 0.75, -0.38), orientation: q4() };
}

const pose = newPose();
const noisy = neutralAngles();

/** Feeds one scripted movement through the tracker model into a trial buffer. */
export function runTrial(
  p: PatientParams,
  hand: Handedness,
  noise: TrackerNoise,
  fromTarget: 'rest' | 'open' | 'fist',
  toTarget: 'open' | 'fist' | 'oppose',
  week: number,
  seed: number,
  seconds = 2,
): TrialBuffer {
  const k = newKinematics(hand);
  const buf = new TrialBuffer();
  const from =
    fromTarget === 'rest' ? patientRest(p) : achievedPose(p, fromTarget === 'open' ? openAngles() : fistAngles(), week);
  const target = toTarget === 'open' ? openAngles() : toTarget === 'fist' ? fistAngles() : opposeAngles();
  const to = achievedPose(p, target, week);
  for (const fr of trialFrames(p, from, to, seconds, FPS, seed)) {
    const ok = noise.apply(fr.angles, 1 / FPS, noisy);
    buildPose(noisy, hand, SHAPE, placement(hand), pose);
    computeKinematics(pose, hand, k);
    buf.push(k, ok);
  }
  return buf;
}

export function opposeAngles() {
  const a = fistAngles();
  a.fingers.forEach((f) => {
    f.mcpFlex = 20;
    f.pipFlex = 20;
    f.dipFlex = 10;
  });
  a.fingers[3].mcpFlex = 45;
  a.fingers[3].pipFlex = 55;
  a.thumb = { cmcFlex: 55, cmcAbd: 35, mcpFlex: 40, ipFlex: 35 };
  return a;
}

export interface SessionPrint {
  trials: HandPrint[];
  value: {
    tam: number[];
    tamTotal: number;
    opening: number;
    spread: number;
    kapandji: number;
  };
}

/** Hand Print: three trials of open, fist and thumb opposition. */
export function simulateHandPrint(
  p: PatientParams,
  hand: Handedness,
  noise: TrackerNoise,
  week: number,
  seed: number,
): SessionPrint {
  const trials: HandPrint[] = [];
  for (let i = 0; i < 3; i++) {
    const open = runTrial(p, hand, noise, 'rest', 'open', week, seed + i * 3);
    const fist = runTrial(p, hand, noise, 'open', 'fist', week, seed + i * 3 + 1);
    const oppose = runTrial(p, hand, noise, 'rest', 'oppose', week, seed + i * 3 + 2);
    trials.push(handPrintFromTrials(fist, open, oppose));
  }
  return {
    trials,
    value: {
      tam: [0, 1, 2, 3].map((f) => sessionValue(trials.map((t) => t.tam[f]))),
      tamTotal: sessionValue(trials.map((t) => t.tamTotal)),
      opening: sessionValue(trials.map((t) => t.opening)),
      spread: sessionValue(trials.map((t) => t.spread)),
      kapandji: sessionValue(trials.map((t) => t.kapandji)),
    },
  };
}

/** Ten fist repetitions; returns the measured range per repetition. */
export function simulateWarmup(
  p: PatientParams,
  hand: Handedness,
  noise: TrackerNoise,
  stiffness: number,
  tau: number,
  seed: number,
): number[] {
  const ranges: number[] = [];
  for (let r = 1; r <= 10; r++) {
    const lost = stiffness * Math.exp(-(r - 1) / tau);
    const q: PatientParams = { ...p, range0: p.range0.map((x) => x * (1 - lost)) };
    const fist = runTrial(q, hand, noise, 'open', 'fist', 0, seed + r, 1.2);
    let s = 0;
    for (let f = 0; f < 4; f++) s += robustPeak(fist.sums[f]);
    ranges.push(s);
  }
  return ranges;
}

export { analyseTapping, fitWarmup };
