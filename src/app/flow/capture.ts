/**
 * Live capture of measurement trials from the tracked hands.
 */
import { Handedness } from '../../core/joints.js';
import { analyseTapping, fitWarmup, handPrintFromTrials, HandPrint, robustPeak, TapResult, TrialBuffer, WarmupFit } from '../../core/measure.js';
import { state } from '../state.js';
import { flow } from './engine.js';

/** Records one movement for the given hands over a window after a cue. */
export async function captureTrial(hands: Handedness[], seconds = 2.2, settle = 0.5): Promise<Record<Handedness, TrialBuffer>> {
  const out = { left: new TrialBuffer(), right: new TrialBuffer() };
  await flow.wait(settle);
  const end = flow.time + seconds;
  await flow.until(() => {
    for (const h of hands) out[h].push(state.hands[h].kin, state.hands[h].valid);
    return flow.time >= end;
  });
  return out;
}

export interface HandPrintRun {
  prints: Record<Handedness, HandPrint[]>;
}

/** The movement to make and its cue. */
export type Movement = 'open' | 'fist' | 'oppose';

export function sessionPrint(trials: HandPrint[]): { tam: number[]; tamTotal: number; opening: number; spread: number; kapandji: number; validShare: number } {
  const med = (xs: number[]) => {
    const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!v.length) return NaN;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  return {
    tam: [0, 1, 2, 3].map((f) => med(trials.map((t) => t.tam[f]))),
    tamTotal: med(trials.map((t) => t.tamTotal)),
    opening: med(trials.map((t) => t.opening)),
    spread: med(trials.map((t) => t.spread)),
    kapandji: med(trials.map((t) => t.kapandji)),
    validShare: Math.min(...trials.map((t) => t.validShare)),
  };
}

export function combineTrial(fist: TrialBuffer, open: TrialBuffer, oppose: TrialBuffer | null): HandPrint {
  return handPrintFromTrials(fist, open, oppose);
}

/** Tapping for `seconds`; returns the analysis per hand. */
export async function captureTapping(hands: Handedness[], seconds = 10): Promise<Record<Handedness, TapResult>> {
  const t: Record<Handedness, number[]> = { left: [], right: [] };
  const g: Record<Handedness, number[]> = { left: [], right: [] };
  const start = flow.time;
  await flow.until(() => {
    for (const h of hands) {
      t[h].push(flow.time - start);
      g[h].push(state.hands[h].valid ? state.hands[h].kin.pinchGap : NaN);
    }
    return flow.time - start >= seconds;
  });
  return {
    left: analyseTapping(t.left, g.left),
    right: analyseTapping(t.right, g.right),
  };
}

/** Peak summed finger flexion during one repetition window. */
export async function captureRepPeak(hand: Handedness, seconds: number): Promise<number> {
  const sums: number[] = [];
  const end = flow.time + seconds;
  await flow.until(() => {
    const k = state.hands[hand].kin;
    if (state.hands[hand].valid) sums.push(k.fingers[0].sum + k.fingers[1].sum + k.fingers[2].sum + k.fingers[3].sum);
    return flow.time >= end;
  });
  return robustPeak(sums);
}

export function warmupFrom(ranges: number[]): WarmupFit | null {
  return fitWarmup(ranges);
}
