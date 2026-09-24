/**
 * Tracker error model applied at the joint-angle level.
 *
 * Totals follow the published Quest 2 figures (9.6 deg mean joint-angle
 * error, 1.1 cm fingertip error, 45 ms delay). The split into static bias,
 * session bias and jitter is an assumption stated in
 * validation/PREREGISTRATION.md.
 */
import { gauss, rng } from '../core/math.js';
import { HandAngles, cloneAngles } from './handmodel.js';

export interface NoiseParams {
  staticSigma: number;
  sessionSigma: number;
  jitterSigma: number;
  /** Jitter correlation time, seconds. */
  jitterTau: number;
  /** Fraction of flexion lost when the fingers occlude each other. */
  occlusionUnderread: number;
  /** Mean summed flexion (deg) above which occlusion applies. */
  occlusionAbove: number;
  /** Fraction of frames lost, in bursts. */
  dropoutRate: number;
  dropoutBurst: number;
  /** Wrist position jitter, metres. */
  wristJitter: number;
}

export const DEFAULT_NOISE: NoiseParams = {
  staticSigma: 10,
  sessionSigma: 6,
  jitterSigma: 2,
  jitterTau: 0.06,
  occlusionUnderread: 0.08,
  occlusionAbove: 180,
  dropoutRate: 0.03,
  dropoutBurst: 4,
  wristJitter: 0.002,
};

export const NO_NOISE: NoiseParams = {
  staticSigma: 0,
  sessionSigma: 0,
  jitterSigma: 0,
  jitterTau: 0.06,
  occlusionUnderread: 0,
  occlusionAbove: 999,
  dropoutRate: 0,
  dropoutBurst: 1,
  wristJitter: 0,
};

/** 20 angle channels: 4 fingers x (mcp, abd, pip, dip) + thumb x 4. */
const CHANNELS = 20;

export class TrackerNoise {
  readonly params: NoiseParams;
  private readonly r: () => number;
  private readonly staticBias = new Float64Array(CHANNELS);
  private readonly sessionBias = new Float64Array(CHANNELS);
  private readonly jitter = new Float64Array(CHANNELS);
  private dropoutLeft = 0;

  constructor(seed: number, params: NoiseParams = DEFAULT_NOISE) {
    this.params = params;
    this.r = rng(seed);
    for (let i = 0; i < CHANNELS; i++) this.staticBias[i] = gauss(this.r) * params.staticSigma;
    this.newSession();
  }

  /** Redraws the session bias, as re-donning the headset would. */
  newSession(): void {
    for (let i = 0; i < CHANNELS; i++) {
      this.sessionBias[i] = gauss(this.r) * this.params.sessionSigma;
      this.jitter[i] = gauss(this.r) * this.params.jitterSigma;
    }
    this.dropoutLeft = 0;
  }

  /** Applies one frame of error. Returns false when the frame is dropped. */
  apply(clean: HandAngles, dt: number, out: HandAngles): boolean {
    const p = this.params;
    const phi = Math.exp(-dt / p.jitterTau);
    const innov = p.jitterSigma * Math.sqrt(1 - phi * phi);
    for (let i = 0; i < CHANNELS; i++) this.jitter[i] = phi * this.jitter[i] + innov * gauss(this.r);

    let meanFlex = 0;
    for (const f of clean.fingers) meanFlex += f.mcpFlex + f.pipFlex + f.dipFlex;
    meanFlex /= 4;
    const occ = meanFlex > p.occlusionAbove ? 1 - p.occlusionUnderread : 1;

    const e = (i: number) => this.staticBias[i] + this.sessionBias[i] + this.jitter[i];
    for (let f = 0; f < 4; f++) {
      const c = clean.fingers[f];
      const o = out.fingers[f];
      o.mcpFlex = c.mcpFlex * occ + e(f * 4);
      o.mcpAbd = c.mcpAbd + e(f * 4 + 1) * 0.3;
      o.pipFlex = c.pipFlex * occ + e(f * 4 + 2);
      o.dipFlex = c.dipFlex * occ + e(f * 4 + 3);
    }
    out.thumb.cmcFlex = clean.thumb.cmcFlex + e(16) * 0.5;
    out.thumb.cmcAbd = clean.thumb.cmcAbd + e(17) * 0.5;
    out.thumb.mcpFlex = clean.thumb.mcpFlex * occ + e(18);
    out.thumb.ipFlex = clean.thumb.ipFlex * occ + e(19);

    if (this.dropoutLeft > 0) {
      this.dropoutLeft--;
      return false;
    }
    if (p.dropoutRate > 0 && this.r() < p.dropoutRate / p.dropoutBurst) {
      this.dropoutLeft = Math.max(0, Math.round(p.dropoutBurst * (0.5 + this.r())) - 1);
      return false;
    }
    return true;
  }

  wristOffset(out: Float64Array): Float64Array {
    out[0] = gauss(this.r) * this.params.wristJitter;
    out[1] = gauss(this.r) * this.params.wristJitter;
    out[2] = gauss(this.r) * this.params.wristJitter;
    return out;
  }
}

export function noisyCopy(a: HandAngles): HandAngles {
  return cloneAngles(a);
}
