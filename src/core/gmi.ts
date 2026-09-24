/**
 * Graded Motor Imagery ladder: Recognise -> Imagine -> Mirror.
 *
 * Recognise is left/right judgement of hands shown at random rotations and
 * postures. Moving on needs accuracy of at least 80% and similar speed for
 * both sides across three sessions. A pain rise of 2 points or more in two
 * sessions steps back one stage.
 */
import { Handedness } from './joints.js';
import { mean, median, rng } from './math.js';

export type GmiStage = 'recognise' | 'imagine' | 'mirror';
export const GMI_STAGES: GmiStage[] = ['recognise', 'imagine', 'mirror'];

export type Posture = 'open' | 'fist' | 'point' | 'pinch' | 'spread' | 'thumb';
export const POSTURES: Posture[] = ['open', 'fist', 'point', 'pinch', 'spread', 'thumb'];

export interface LateralityStimulus {
  hand: Handedness;
  posture: Posture;
  /** Rotation of the displayed hand, degrees. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Palm or back of the hand toward the viewer. */
  palmUp: boolean;
}

/** A balanced, shuffled block of stimuli: equal left and right. */
export function lateralityBlock(seed: number, count = 20): LateralityStimulus[] {
  const r = rng(seed);
  const out: LateralityStimulus[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      hand: i % 2 === 0 ? 'left' : 'right',
      posture: POSTURES[Math.floor(r() * POSTURES.length)],
      yaw: Math.round((r() * 360) / 45) * 45,
      pitch: [-40, -20, 0, 20, 40][Math.floor(r() * 5)],
      roll: [-60, -30, 0, 30, 60, 90][Math.floor(r() * 6)],
      palmUp: r() < 0.5,
    });
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface LateralityAnswer {
  stimulus: LateralityStimulus;
  answer: Handedness | null;
  /** Seconds from the hand appearing to the answer. */
  rt: number;
}

export interface LateralityScore {
  accuracy: number;
  accuracyLeft: number;
  accuracyRight: number;
  rtLeft: number;
  rtRight: number;
  /** |RT left - RT right| / mean RT. */
  asymmetry: number;
  n: number;
}

export function scoreLaterality(answers: LateralityAnswer[]): LateralityScore {
  const side = (h: Handedness) => answers.filter((a) => a.stimulus.hand === h);
  const acc = (list: LateralityAnswer[]) =>
    list.length ? list.filter((a) => a.answer === a.stimulus.hand).length / list.length : NaN;
  const rt = (list: LateralityAnswer[]) =>
    median(list.filter((a) => a.answer === a.stimulus.hand).map((a) => a.rt));
  const rl = rt(side('left'));
  const rr = rt(side('right'));
  return {
    accuracy: acc(answers),
    accuracyLeft: acc(side('left')),
    accuracyRight: acc(side('right')),
    rtLeft: rl,
    rtRight: rr,
    asymmetry: Math.abs(rl - rr) / mean([rl, rr]),
    n: answers.length,
  };
}

export interface GmiSession {
  stage: GmiStage;
  painBefore: number;
  painAfter: number;
  laterality?: LateralityScore;
  completed: boolean;
}

export const GATE = { accuracy: 0.8, asymmetry: 0.2, sessions: 3, painRise: 2 };

export interface GmiDecision {
  stage: GmiStage;
  change: 'advance' | 'stay' | 'step-back';
  reason: string;
}

/** Decides the stage for the next session from the history. */
export function nextGmiStage(history: GmiSession[]): GmiDecision {
  if (history.length === 0) return { stage: 'recognise', change: 'stay', reason: 'First session.' };
  const current = history[history.length - 1].stage;
  const idx = GMI_STAGES.indexOf(current);
  const atStage = history.filter((h) => h.stage === current);
  const lastTwo = atStage.slice(-2);
  if (lastTwo.length === 2 && lastTwo.every((h) => h.painAfter - h.painBefore >= GATE.painRise)) {
    const back = GMI_STAGES[Math.max(0, idx - 1)];
    return {
      stage: back,
      change: idx > 0 ? 'step-back' : 'stay',
      reason: 'Pain rose by 2 points or more in the last two sessions.',
    };
  }
  const lastN = atStage.slice(-GATE.sessions);
  if (lastN.length < GATE.sessions || !lastN.every((h) => h.completed)) {
    return { stage: current, change: 'stay', reason: `${GATE.sessions - lastN.length} more session(s) at this stage.` };
  }
  if (current === 'recognise') {
    const ok = lastN.every(
      (h) => h.laterality && h.laterality.accuracy >= GATE.accuracy && h.laterality.asymmetry <= GATE.asymmetry,
    );
    if (!ok) return { stage: current, change: 'stay', reason: 'Accuracy of 80% and even speed on both sides are needed.' };
  }
  const painOk = lastN.every((h) => h.painAfter - h.painBefore < GATE.painRise);
  if (!painOk) return { stage: current, change: 'stay', reason: 'Pain rose in a recent session.' };
  if (idx === GMI_STAGES.length - 1) return { stage: current, change: 'stay', reason: 'Final stage.' };
  return { stage: GMI_STAGES[idx + 1], change: 'advance', reason: 'Three steady sessions at this stage.' };
}
