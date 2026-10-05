/**
 * Metric definitions and the analyses that turn frames into session values.
 */
import { HandKinematics, kapandjiContinuous } from './kinematics.js';
import { clamp, mean, median } from './math.js';
import { SIMULATED_SEM } from './priors.generated.js';

export type MetricId =
  | 'tam.index'
  | 'tam.middle'
  | 'tam.ring'
  | 'tam.little'
  | 'tam.total'
  | 'opening'
  | 'spread'
  | 'kapandji'
  | 'tap.rate'
  | 'tap.amplitude'
  | 'tap.decrement'
  | 'fist.time'
  | 'warmup.stiffness'
  | 'individuation'
  | 'pain'
  | 'trunk.lean';

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: string;
  higherIsBetter: boolean;
  decimals: number;
  /** Standard error of a session value under the default tracker model (S2). */
  priorSem: number;
}

/**
 * Hand Print priors come from the S2 simulation under the default tracker
 * model (src/core/priors.generated.ts, written by `npm run validate`). The
 * remaining priors are conservative starting values; every prior is replaced
 * by the user's own error estimate after five sessions.
 */
const BASE_METRICS: Record<MetricId, MetricDef> = {
  'tam.index': { id: 'tam.index', label: 'Index finger range', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 10.4 },
  'tam.middle': { id: 'tam.middle', label: 'Middle finger range', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 10.4 },
  'tam.ring': { id: 'tam.ring', label: 'Ring finger range', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 10.4 },
  'tam.little': { id: 'tam.little', label: 'Little finger range', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 10.4 },
  'tam.total': { id: 'tam.total', label: 'Whole-hand range', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 21 },
  opening: { id: 'opening', label: 'Hand opening', unit: '%', higherIsBetter: true, decimals: 0, priorSem: 1.6 },
  spread: { id: 'spread', label: 'Finger spread', unit: 'deg', higherIsBetter: true, decimals: 0, priorSem: 3.5 },
  kapandji: { id: 'kapandji', label: 'Thumb reach', unit: '/10', higherIsBetter: true, decimals: 0, priorSem: 0.5 },
  'tap.rate': { id: 'tap.rate', label: 'Tap rate', unit: '/s', higherIsBetter: true, decimals: 1, priorSem: 0.15 },
  'tap.amplitude': { id: 'tap.amplitude', label: 'Tap size', unit: 'cm', higherIsBetter: true, decimals: 1, priorSem: 0.4 },
  'tap.decrement': { id: 'tap.decrement', label: 'Tap fade', unit: '%/tap', higherIsBetter: false, decimals: 1, priorSem: 0.5 },
  'fist.time': { id: 'fist.time', label: 'Time to fist', unit: 's', higherIsBetter: false, decimals: 2, priorSem: 0.06 },
  'warmup.stiffness': { id: 'warmup.stiffness', label: 'Morning stiffness', unit: '%', higherIsBetter: false, decimals: 0, priorSem: 2.5 },
  individuation: { id: 'individuation', label: 'Finger independence', unit: '%', higherIsBetter: true, decimals: 0, priorSem: 4 },
  pain: { id: 'pain', label: 'Pain', unit: '/10', higherIsBetter: false, decimals: 0, priorSem: 0.7 },
  'trunk.lean': { id: 'trunk.lean', label: 'Trunk lean', unit: 'cm', higherIsBetter: false, decimals: 1, priorSem: 0.8 },
};

export const METRICS: Record<MetricId, MetricDef> = Object.fromEntries(
  Object.entries(BASE_METRICS).map(([id, def]) => [
    id,
    { ...def, priorSem: SIMULATED_SEM[id] ?? def.priorSem },
  ]),
) as Record<MetricId, MetricDef>;

export const FINGER_TAM: MetricId[] = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'];

/** Mean of the `k` largest values: a peak that one noisy frame cannot set. */
export function robustPeak(values: ArrayLike<number>, k = 5): number {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => b - a);
  if (v.length === 0) return NaN;
  return mean(v.slice(0, Math.min(k, v.length)));
}

export function robustTrough(values: ArrayLike<number>, k = 5): number {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  return mean(v.slice(0, Math.min(k, v.length)));
}

/**
 * Collects per-frame kinematics during one trial of one movement. Only valid
 * frames are kept; the trial reports "could not measure" below `minFrames`.
 */
export class TrialBuffer {
  readonly sums: number[][] = [[], [], [], []];
  readonly joint: number[][][] = [0, 1, 2, 3].map(() => [[], [], []]);
  readonly opening: number[] = [];
  readonly spread: number[] = [];
  readonly kapandji: number[] = [];
  valid = 0;
  total = 0;

  push(k: HandKinematics, isValid: boolean): void {
    this.total++;
    if (!isValid || !k.valid) return;
    this.valid++;
    for (let f = 0; f < 4; f++) {
      const fk = k.fingers[f];
      this.sums[f].push(fk.sum);
      this.joint[f][0].push(fk.mcp);
      this.joint[f][1].push(fk.pip);
      this.joint[f][2].push(fk.dip);
    }
    this.opening.push(k.opening * 100);
    this.spread.push(k.spread);
    this.kapandji.push(kapandjiContinuous(k));
  }

  get validShare(): number {
    return this.total ? this.valid / this.total : 0;
  }
}

export const MIN_VALID_FRAMES = 12;
export const MIN_VALID_SHARE = 0.5;

export interface HandPrint {
  /** Per finger (index..little) total active motion, degrees. */
  tam: number[];
  tamTotal: number;
  opening: number;
  spread: number;
  kapandji: number;
  /** Per finger: peak flexion sum at fist and residual flexion at open. */
  fistSum: number[];
  openDeficit: number[];
  validShare: number;
}

/**
 * Total active motion per finger (ASSH): summed MCP, PIP and DIP flexion at
 * the fist, minus the flexion each joint still holds when fully opened
 * (extension deficit; hyperextension counts as zero deficit).
 */
export function handPrintFromTrials(fist: TrialBuffer, open: TrialBuffer, oppose: TrialBuffer | null): HandPrint {
  const tam: number[] = [];
  const fistSum: number[] = [];
  const openDeficit: number[] = [];
  for (let f = 0; f < 4; f++) {
    if (fist.valid < MIN_VALID_FRAMES || open.valid < MIN_VALID_FRAMES || fist.validShare < MIN_VALID_SHARE || open.validShare < MIN_VALID_SHARE) {
      tam.push(NaN);
      fistSum.push(NaN);
      openDeficit.push(NaN);
      continue;
    }
    let flex = 0;
    let deficit = 0;
    for (let j = 0; j < 3; j++) {
      flex += robustPeak(fist.joint[f][j]);
      deficit += Math.max(0, robustTrough(open.joint[f][j]));
    }
    fistSum.push(flex);
    openDeficit.push(deficit);
    tam.push(Math.max(0, flex - deficit));
  }
  const tamTotal = tam.every(Number.isFinite) ? tam.reduce((a, b) => a + b, 0) : NaN;
  return {
    tam,
    tamTotal,
    opening: open.valid >= MIN_VALID_FRAMES && open.validShare >= MIN_VALID_SHARE ? robustPeak(open.opening) : NaN,
    spread: open.valid >= MIN_VALID_FRAMES && open.validShare >= MIN_VALID_SHARE ? robustPeak(open.spread) : NaN,
    kapandji: oppose && oppose.valid >= MIN_VALID_FRAMES && oppose.validShare >= MIN_VALID_SHARE ? robustPeak(oppose.kapandji, 3) : NaN,
    fistSum,
    openDeficit,
    validShare: Math.min(fist.validShare, open.validShare),
  };
}

/** Median of trial values, ignoring trials that could not be measured. */
export function sessionValue(trials: number[]): number {
  const v = trials.filter(Number.isFinite);
  return v.length ? median(v) : NaN;
}

// ------------------------------------------------------------------ tapping

export interface TapResult {
  taps: number;
  rate: number;
  /** Mean opening between taps, cm. */
  amplitude: number;
  /** Linear amplitude decline per tap, % of the first taps' amplitude. */
  decrement: number;
  /** Inter-tap intervals above twice the median. */
  hesitations: number;
  validShare: number;
}

/**
 * Index-thumb tapping from the pinch gap series. A tap is a closing below
 * `closeAt` after an opening above `openAt`; hysteresis rejects jitter.
 */
export function analyseTapping(t: number[], gap: number[], closeAt = 0.02, openAt = 0.035): TapResult {
  const samples = Math.min(t.length, gap.length);
  let valid = 0;
  for (let i = 0; i < samples; i++) if (Number.isFinite(t[i]) && Number.isFinite(gap[i])) valid++;
  const validShare = samples ? valid / samples : 0;
  if (valid < MIN_VALID_FRAMES || validShare < MIN_VALID_SHARE) return { taps: 0, rate: NaN, amplitude: NaN, decrement: NaN, hesitations: 0, validShare };
  const tapTimes: number[] = [];
  const amps: number[] = [];
  let state: 'open' | 'closed' = gap[0] < closeAt ? 'closed' : 'open';
  let peak = 0;
  for (let i = 0; i < samples; i++) {
    const g = gap[i];
    if (!Number.isFinite(g) || !Number.isFinite(t[i])) { state = 'closed'; peak = 0; continue; }
    if (state === 'open') {
      peak = Math.max(peak, g);
      if (g < closeAt) {
        state = 'closed';
        tapTimes.push(t[i]);
        amps.push(peak * 100);
        peak = 0;
      }
    } else if (g > openAt) {
      state = 'open';
      peak = g;
    }
  }
  // the first closing has no preceding full opening when the trial starts pinched
  if (amps.length && amps[0] < openAt * 100) {
    amps.shift();
    tapTimes.shift();
  }
  const n = tapTimes.length;
  const duration = t.length ? t[t.length - 1] - t[0] : 0;
  const intervals: number[] = [];
  for (let i = 1; i < n; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
  const medI = median(intervals);
  const hesitations = intervals.filter((x) => x > 2 * medI).length;
  let decrement = NaN;
  if (amps.length >= 4) {
    const ref = mean(amps.slice(0, 3));
    const xs = amps.map((_, i) => i);
    const mx = mean(xs);
    const my = mean(amps);
    let num = 0;
    let den = 0;
    for (let i = 0; i < amps.length; i++) {
      num += (xs[i] - mx) * (amps[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    decrement = den > 0 && ref > 0 ? (-(num / den) / ref) * 100 : NaN;
  }
  return {
    taps: n,
    rate: duration > 0 ? n / duration : NaN,
    amplitude: amps.length ? mean(amps) : NaN,
    decrement,
    hesitations,
    validShare,
  };
}

// -------------------------------------------------------------- time to fist

/**
 * From a cue at t = 0: time until the mean finger flexion reaches 90% of its
 * excursion from the rest level to the peak.
 */
export function timeToFist(t: number[], meanFlex: number[]): number {
  const v = meanFlex.filter(Number.isFinite);
  if (v.length < 5) return NaN;
  const rest = median(meanFlex.slice(0, Math.max(3, Math.floor(meanFlex.length * 0.05))).filter(Number.isFinite));
  const peak = robustPeak(meanFlex);
  if (!(peak - rest > 20)) return NaN;
  const target = rest + 0.9 * (peak - rest);
  for (let i = 0; i < meanFlex.length; i++) if (meanFlex[i] >= target) return t[i];
  return NaN;
}

// ------------------------------------------------------------------ warm-up

export interface WarmupFit {
  /** Plateau range the hand reaches once warm. */
  plateau: number;
  /** Range on the first repetition. */
  first: number;
  /** Repetitions to close 63% of the gap. */
  tau: number;
  /** Share of the plateau missing on the first repetition, %. */
  stiffness: number;
  /** Repetitions to reach 90% of the plateau gap. */
  repsTo90: number;
  sse: number;
}

/**
 * Fits range(r) = P - (P - A) exp(-(r - 1) / tau) over repetitions r = 1..R.
 * For each tau on a grid the model is linear in P and A.
 */
export function fitWarmup(ranges: number[]): WarmupFit | null {
  const pts = ranges.map((y, i) => [i + 1, y] as const).filter(([, y]) => Number.isFinite(y));
  if (pts.length < 4) return null;
  const solve = (tau: number): WarmupFit | null => {
    // y = P (1 - e) + A e ; linear least squares in P and A for a fixed tau
    let s11 = 0;
    let s12 = 0;
    let s22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const [r, y] of pts) {
      const e = Math.exp(-(r - 1) / tau);
      s11 += (1 - e) * (1 - e);
      s12 += (1 - e) * e;
      s22 += e * e;
      b1 += (1 - e) * y;
      b2 += e * y;
    }
    const det = s11 * s22 - s12 * s12;
    if (Math.abs(det) < 1e-12) return null;
    const P = (b1 * s22 - b2 * s12) / det;
    const A = (s11 * b2 - s12 * b1) / det;
    let sse = 0;
    for (const [r, y] of pts) {
      const e = Math.exp(-(r - 1) / tau);
      sse += (y - (P * (1 - e) + A * e)) ** 2;
    }
    return {
      plateau: P,
      first: A,
      tau,
      stiffness: P > 0 ? clamp(((P - A) / P) * 100, 0, 100) : NaN,
      repsTo90: 1 + tau * Math.log(10),
      sse,
    };
  };
  let best: WarmupFit | null = null;
  for (let tau = 0.25; tau <= 12; tau *= 1.06) {
    const f = solve(tau);
    if (f && (!best || f.sse < best.sse)) best = f;
  }
  if (!best) return null;
  // refine tau by golden-section search around the best grid point
  let lo = best.tau / 1.06;
  let hi = best.tau * 1.06;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    const fa = solve(a);
    const fb = solve(b);
    if (!fa || !fb) break;
    if (fa.sse < fb.sse) hi = b;
    else lo = a;
  }
  const refined = solve((lo + hi) / 2);
  return refined && refined.sse <= best.sse ? refined : best;
}

// ------------------------------------------------------------- individuation

/**
 * Individuation during a single-finger press: 1 minus the mean movement of
 * the other fingers relative to the instructed finger's movement.
 */
export function individuation(target: number, baseline: number[], peak: number[]): number {
  const moveTarget = Math.abs(peak[target] - baseline[target]);
  if (!(moveTarget > 10)) return NaN;
  let other = 0;
  let n = 0;
  for (let f = 0; f < peak.length; f++) {
    if (f === target) continue;
    other += Math.abs(peak[f] - baseline[f]);
    n++;
  }
  return clamp(1 - other / n / moveTarget, 0, 1) * 100;
}
