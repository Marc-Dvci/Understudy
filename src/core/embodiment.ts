/**
 * Proprioceptive drift: the standard measure of the rubber-hand illusion.
 *
 * The hidden hand's true position is known from tracking before it is covered.
 * The user touches the table above where they feel it, three times before and
 * three times after mirroring with the virtual hand displaced. Drift is how far
 * the felt position moved toward the virtual hand, in centimetres.
 */
import { mean } from './math.js';

export interface Point2 {
  x: number;
  z: number;
}

export interface DriftResult {
  /** Signed error toward the virtual hand before mirroring, cm, per touch. */
  pre: number[];
  post: number[];
  /** Mean post minus mean pre, cm; positive means toward the virtual hand. */
  driftCm: number;
}

/** Signed distance of each touch from the true position along the direction to the virtual hand, cm. */
export function towardVirtual(truth: Point2, virtual: Point2, touches: Point2[]): number[] {
  const dx = virtual.x - truth.x;
  const dz = virtual.z - truth.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  return touches.map((p) => ((p.x - truth.x) * ux + (p.z - truth.z) * uz) * 100);
}

export function computeDrift(truth: Point2, virtual: Point2, pre: Point2[], post: Point2[]): DriftResult {
  const a = towardVirtual(truth, virtual, pre);
  const b = towardVirtual(truth, virtual, post);
  return { pre: a, post: b, driftCm: mean(b) - mean(a) };
}

/** Plain-language reading of a drift result for the result card. */
export function driftSentence(d: DriftResult): string {
  const cm = Math.abs(d.driftCm);
  if (!Number.isFinite(d.driftCm)) return 'Not enough touches to measure.';
  if (d.driftCm >= 1) return `Your sense of your hidden hand moved ${cm.toFixed(1)} cm toward the hand you saw.`;
  if (d.driftCm <= -1) return `Your sense of your hidden hand moved ${cm.toFixed(1)} cm away from the hand you saw.`;
  return 'Your sense of your hidden hand stayed where it was.';
}
