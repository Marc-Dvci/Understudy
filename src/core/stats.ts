/**
 * Measurement error, minimal detectable change and the personal usual range.
 *
 * A session value is the median of three trials. Its standard error comes from
 * two estimators and the larger one is used:
 *  - within-session spread of the trials, scaled for a median of three
 *    (the variance of the median of three normal draws is 0.449 sigma^2);
 *  - successive differences between session values (von Neumann), which also
 *    captures day-to-day variation and is robust to a slow real trend.
 * Before a user has enough sessions, the simulation-derived prior is used.
 */
import { mean, median, variance } from './math.js';

export const MEDIAN3_SD_FACTOR = Math.sqrt(0.449);
export const Z95 = 1.96;

/** Pooled within-session SD of trials, scaled to the SD of a median of three. */
export function semFromTrials(sessions: number[][]): number {
  let num = 0;
  let den = 0;
  for (const trials of sessions) {
    const finite = trials.filter(Number.isFinite);
    if (finite.length < 2) continue;
    num += variance(finite) * (finite.length - 1);
    den += finite.length - 1;
  }
  if (den === 0) return NaN;
  return Math.sqrt(num / den) * MEDIAN3_SD_FACTOR;
}

/** Standard error from successive differences of session values. */
export function semFromSeries(values: number[]): number {
  const v = values.filter(Number.isFinite);
  if (v.length < 3) return NaN;
  let s = 0;
  for (let i = 1; i < v.length; i++) s += (v[i] - v[i - 1]) ** 2;
  return Math.sqrt(s / (v.length - 1) / 2);
}

export function mdc95(sem: number): number {
  return Z95 * Math.SQRT2 * sem;
}

export interface ErrorEstimate {
  sem: number;
  mdc: number;
  source: 'prior' | 'personal';
}

/**
 * Personal error once 5 sessions exist, otherwise the prior. The personal value
 * never drops below half the prior, so a lucky run of quiet days cannot make
 * the instrument look sharper than the tracker allows.
 */
export function estimateError(trialsBySession: number[][], sessionValues: number[], priorSem: number): ErrorEstimate {
  if (sessionValues.filter(Number.isFinite).length < 5) {
    return { sem: priorSem, mdc: mdc95(priorSem), source: 'prior' };
  }
  const a = semFromTrials(trialsBySession);
  const b = semFromSeries(sessionValues);
  let sem = Math.max(Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0);
  sem = Math.max(sem, priorSem * 0.5);
  return { sem, mdc: mdc95(sem), source: 'personal' };
}

export interface UsualRange {
  center: number;
  low: number;
  high: number;
  n: number;
}

/** Rolling median of up to the last 14 sessions, +/- 1.96 SEM. */
export function usualRange(values: number[], sem: number, window = 14): UsualRange | null {
  const v = values.filter(Number.isFinite).slice(-window);
  if (v.length < 3) return null;
  const c = median(v);
  const band = Z95 * sem;
  return { center: c, low: c - band, high: c + band, n: v.length };
}

export type Change = 'improved' | 'declined' | 'steady' | 'unknown';

/** Classifies today's value against a baseline using the MDC. */
export function classifyChange(today: number, baseline: number, mdc: number, higherIsBetter: boolean): Change {
  if (!Number.isFinite(today) || !Number.isFinite(baseline) || !Number.isFinite(mdc)) return 'unknown';
  const d = today - baseline;
  if (Math.abs(d) <= mdc) return 'steady';
  return d > 0 === higherIsBetter ? 'improved' : 'declined';
}

/**
 * True when the last two sessions both fall on the worse side of the usual
 * range computed from the sessions before them.
 */
export function belowUsualTwice(values: number[], sem: number, higherIsBetter: boolean): boolean {
  const v = values.filter(Number.isFinite);
  if (v.length < 5) return false;
  const history = v.slice(0, -2);
  const range = usualRange(history, sem);
  if (!range) return false;
  const last2 = v.slice(-2);
  return last2.every((x) => (higherIsBetter ? x < range.low : x > range.high));
}

export function summarise(values: number[]): { mean: number; median: number; n: number } {
  const v = values.filter(Number.isFinite);
  return { mean: mean(v), median: median(v), n: v.length };
}

/** Spearman rank correlation. */
export function spearman(a: number[], b: number[]): number {
  const rank = (x: number[]) => {
    const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(x.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r as number[];
  };
  const ra = rank(a);
  const rb = rank(b);
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}
