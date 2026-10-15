/**
 * Detects an attempt to move a finger from the tracked Understudy hand alone.
 *
 * Research systems use surface EMG to know when a weak hand is trying. Here
 * the tracked finger is its own sensor. A small attempt is a slow, small
 * displacement, so the detector watches displacement, not velocity: a fast
 * smoothed flexion signal minus a slow baseline that only follows the finger
 * while no attempt is active. A 10-second rest calibration measures the spread
 * of that displacement; an attempt is a displacement above k times the spread,
 * sustained for 150 ms, in the direction the Lead finger is moving.
 */
import { clamp } from './math.js';

export interface AttemptConfig {
  /** Threshold in units of the rest displacement SD. */
  k: number;
  /** Minimum time above threshold, seconds. */
  holdOn: number;
  /** Time below threshold before release, seconds. */
  holdOff: number;
  /** Fast smoothing time constant, seconds. */
  fast: number;
  /** Baseline time constant, seconds. */
  baseline: number;
  /** Gate attack and release time constants, seconds. */
  attack: number;
  release: number;
  /** Floor on the displacement SD, degrees. */
  minSigma: number;
  /** How long the Lead's last direction counts after it stops, seconds. */
  leadMemory: number;
}

export const DEFAULT_ATTEMPT: AttemptConfig = {
  k: 2.5,
  holdOn: 0.15,
  holdOff: 0.3,
  fast: 0.25,
  baseline: 3,
  attack: 0.08,
  release: 0.3,
  minSigma: 0.3,
  leadMemory: 1.0,
};

export class FingerAttemptDetector {
  private readonly cfg: AttemptConfig;
  private fastV = NaN;
  private base = NaN;
  private above = 0;
  private below = 0;
  private restSamples: number[] = [];
  private leadDir = 0;
  private leadAge = Infinity;
  sigma = NaN;
  active = false;
  /** Smoothed 0..1 gate for rendering. */
  gate = 0;
  /** Onsets since the last reset, for evaluation. */
  onsets = 0;

  constructor(cfg: AttemptConfig = DEFAULT_ATTEMPT) {
    this.cfg = cfg;
  }

  reset(): void {
    this.fastV = NaN;
    this.base = NaN;
    this.above = 0;
    this.below = 0;
    this.active = false;
    this.gate = 0;
    this.onsets = 0;
    this.leadDir = 0;
    this.leadAge = Infinity;
  }

  get calibrated(): boolean {
    return Number.isFinite(this.sigma);
  }

  /** Current displacement from the baseline, degrees. */
  get displacement(): number {
    return Number.isFinite(this.fastV) && Number.isFinite(this.base) ? this.fastV - this.base : 0;
  }

  private filter(angle: number, dt: number): void {
    if (!Number.isFinite(angle) || dt <= 0) return;
    if (!Number.isFinite(this.fastV)) {
      this.fastV = angle;
      this.base = angle;
      return;
    }
    this.fastV += (angle - this.fastV) * (1 - Math.exp(-dt / this.cfg.fast));
    // the baseline holds still during an attempt so a held effort stays visible
    if (!this.active) this.base += (this.fastV - this.base) * (1 - Math.exp(-dt / this.cfg.baseline));
  }

  /** Feed one rest-calibration frame. */
  calibrate(angle: number, dt: number): void {
    if (!Number.isFinite(angle) || !Number.isFinite(dt) || dt <= 0) return;
    this.filter(angle, dt);
    if (Number.isFinite(this.fastV)) this.restSamples.push(this.displacement);
  }

  finishCalibration(): number {
    const v = this.restSamples.slice(Math.floor(this.restSamples.length * 0.2));
    this.restSamples = [];
    if (v.length < 10) {
      this.sigma = NaN;
      return this.sigma;
    }
    let s = 0;
    for (const x of v) s += x * x;
    this.sigma = Math.max(Math.sqrt(s / v.length), this.cfg.minSigma);
    const keepBase = this.base;
    const keepFast = this.fastV;
    this.reset();
    this.base = keepBase;
    this.fastV = keepFast;
    return this.sigma;
  }

  /**
   * One frame. `leadVelocity` is the Lead finger's flexion velocity (deg/s),
   * `leadMoving` whether it is above the Lead's own threshold.
   */
  update(angle: number, dt: number, leadVelocity: number, leadMoving: boolean): boolean {
    if (!Number.isFinite(angle) || !Number.isFinite(dt) || dt <= 0) {
      this.active = false;
      this.gate = this.above = this.below = 0;
      this.leadDir = 0;
      this.leadAge = Infinity;
      return false;
    }
    this.filter(angle, dt);
    if (!this.calibrated || !Number.isFinite(this.fastV)) {
      this.gate += (0 - this.gate) * (1 - Math.exp(-dt / this.cfg.release));
      return false;
    }
    const d = this.displacement;
    const threshold = this.cfg.k * this.sigma;
    // An attempt must follow the Lead: flexing after the Lead flexed, or
    // extending after it extended. A weak finger lags the Lead, so the Lead's
    // direction is remembered for `leadMemory` seconds after it stops.
    if (leadMoving) {
      this.leadDir = Math.sign(leadVelocity);
      this.leadAge = 0;
    } else {
      this.leadAge += dt;
    }
    const agrees = this.leadAge <= this.cfg.leadMemory && Math.sign(d) === this.leadDir;
    const over = Math.abs(d) > threshold && agrees;
    if (over) {
      this.above += dt;
      this.below = 0;
    } else {
      this.below += dt;
      this.above = 0;
    }
    if (!this.active && this.above >= this.cfg.holdOn) {
      this.active = true;
      this.onsets++;
    } else if (this.active && this.below >= this.cfg.holdOff) {
      this.active = false;
    }
    const target = this.active ? 1 : 0;
    const tc = this.active ? this.cfg.attack : this.cfg.release;
    this.gate = clamp(this.gate + (target - this.gate) * (1 - Math.exp(-dt / tc)), 0, 1);
    return this.active;
  }
}

/** Velocity estimate for the Lead finger, with its own motion threshold. */
export class LeadMotion {
  private smoothed = NaN;
  velocity = 0;
  constructor(
    private readonly smoothing = 0.06,
    readonly threshold = 15,
  ) {}

  update(angle: number, dt: number): void {
    if (!Number.isFinite(angle) || dt <= 0) return;
    if (!Number.isFinite(this.smoothed)) {
      this.smoothed = angle;
      return;
    }
    const a = 1 - Math.exp(-dt / this.smoothing);
    const prev = this.smoothed;
    this.smoothed += (angle - this.smoothed) * a;
    const v = (this.smoothed - prev) / dt;
    this.velocity += (v - this.velocity) * a;
  }

  get moving(): boolean {
    return Math.abs(this.velocity) > this.threshold;
  }
}
