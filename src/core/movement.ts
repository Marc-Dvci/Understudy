/**
 * Measurements for the functional exercises: forearm turning, wrist lift,
 * pinch and repetition counting. Poses are 25 column-major joint matrices;
 * in WebXR joint frames -Z runs along the bones and +Y leaves the back of the
 * hand.
 */
import { J } from './joints.js';
import { DEG, Vec3, v3 } from './math.js';

const ax = v3();
const bx = v3();
const tmp = v3();

/**
 * Roll of the hand about its own long axis, degrees: 0 with the back of the
 * hand up, about ±180 palm up. The sign follows the right-hand rule about the
 * direction the fingers point.
 */
export function forearmRoll(pose: ArrayLike<number>, up: Vec3): number {
  const o = J.wrist * 16;
  // long axis (fingers) = -Z column; back-of-hand normal = +Y column
  ax[0] = -pose[o + 8]; ax[1] = -pose[o + 9]; ax[2] = -pose[o + 10];
  bx[0] = pose[o + 4]; bx[1] = pose[o + 5]; bx[2] = pose[o + 6];
  // `up` projected into the plane across the long axis
  const k = up[0] * ax[0] + up[1] * ax[1] + up[2] * ax[2];
  tmp[0] = up[0] - ax[0] * k; tmp[1] = up[1] - ax[1] * k; tmp[2] = up[2] - ax[2] * k;
  const cos = tmp[0] * bx[0] + tmp[1] * bx[1] + tmp[2] * bx[2];
  // (tmp x bx) . axis gives the signed sine
  const sin = (tmp[1] * bx[2] - tmp[2] * bx[1]) * ax[0] + (tmp[2] * bx[0] - tmp[0] * bx[2]) * ax[1] + (tmp[0] * bx[1] - tmp[1] * bx[0]) * ax[2];
  return Math.atan2(sin, cos) * DEG;
}

/** Elevation of the hand above the table plane, degrees: wrist to middle knuckle against `up`. */
export function wristPitch(pose: ArrayLike<number>, up: Vec3): number {
  const w = J.wrist * 16;
  const m = J.middleProx * 16;
  const dx = pose[m + 12] - pose[w + 12];
  const dy = pose[m + 13] - pose[w + 13];
  const dz = pose[m + 14] - pose[w + 14];
  const len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6)) return NaN;
  return Math.asin(Math.max(-1, Math.min(1, (dx * up[0] + dy * up[1] + dz * up[2]) / len))) * DEG;
}

/** Distance between the thumb and index fingertips, metres. */
export function pinchDistance(pose: ArrayLike<number>): number {
  const t = J.thumbTip * 16;
  const i = J.indexTip * 16;
  return Math.hypot(pose[t + 12] - pose[i + 12], pose[t + 13] - pose[i + 13], pose[t + 14] - pose[i + 14]);
}

/** Midpoint of the thumb and index fingertips. */
export function pinchPoint(pose: ArrayLike<number>, out: Vec3 = v3()): Vec3 {
  const t = J.thumbTip * 16;
  const i = J.indexTip * 16;
  out[0] = (pose[t + 12] + pose[i + 12]) / 2;
  out[1] = (pose[t + 13] + pose[i + 13]) / 2;
  out[2] = (pose[t + 14] + pose[i + 14]) / 2;
  return out;
}

/** Smallest signed difference between two angles, degrees. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * Counts out-and-back repetitions of a signal measured from its starting
 * value, with hysteresis: a repetition is `out` past the start, then back
 * within `back` of it. Also keeps the largest excursion.
 */
export class RepCounter {
  reps = 0;
  /** Largest absolute excursion from the start. */
  peak = 0;
  private start = NaN;
  private outside = false;

  constructor(private readonly out: number, private readonly back: number, private readonly circular = false) {}

  /** Feeds one value; returns true on the frame a repetition completes. NaN is ignored. */
  update(value: number): boolean {
    if (!Number.isFinite(value)) return false;
    if (!Number.isFinite(this.start)) this.start = value;
    const d = Math.abs(this.circular ? angleDelta(value, this.start) : value - this.start);
    this.peak = Math.max(this.peak, d);
    if (!this.outside && d >= this.out) this.outside = true;
    else if (this.outside && d <= this.back) {
      this.outside = false;
      this.reps++;
      return true;
    }
    return false;
  }

  /** Progress toward the next `out`, 0..1, for visual feedback. */
  level(value: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(this.start)) return 0;
    const d = Math.abs(this.circular ? angleDelta(value, this.start) : value - this.start);
    return Math.min(1, d / this.out);
  }
}
