/**
 * Synthetic patients and the movement scripts the app asks for.
 *
 * A patient maps the movement the app asks for (a healthy target pose) to the
 * pose the hand actually reaches: a reduced range per finger around a resting
 * flexion bias, poor individuation (mass synergy), slower movement, optional
 * tremor, and a recovery trajectory over weeks.
 */
import { gauss, rng } from '../core/math.js';
import {
  HandAngles,
  cloneAngles,
  fistAngles,
  lerpAngles,
  neutralAngles,
  openAngles,
  restAngles,
} from './handmodel.js';

export type Trajectory = 'steady' | 'plateau' | 'none' | 'relapse';

export interface PatientParams {
  seed: number;
  /** Fraction of healthy range per finger (thumb, index, middle, ring, little) at week 0. */
  range0: number[];
  /** Extra resting flexion (flexor tone), degrees per joint. */
  tone: number;
  /** 0 = perfect individuation, 1 = all fingers move together. */
  synergy: number;
  /** Movement time constant, seconds (healthy about 0.12). */
  slowness: number;
  tremorAmp: number;
  tremorHz: number;
  trajectory: Trajectory;
  /** Range gained by week 8 on a steady trajectory, as a fraction of healthy. */
  gain8: number;
}

export function healthyParams(seed: number): PatientParams {
  return {
    seed,
    range0: [1, 1, 1, 1, 1],
    tone: 0,
    synergy: 0.1,
    slowness: 0.12,
    tremorAmp: 0,
    tremorHz: 5,
    trajectory: 'none',
    gain8: 0,
  };
}

export function randomPatient(seed: number, trajectory: Trajectory): PatientParams {
  const r = rng(seed * 7919 + 17);
  const base = 0.15 + r() * 0.5;
  return {
    seed,
    range0: [0, 1, 2, 3, 4].map(() => Math.min(1, Math.max(0.05, base + (r() - 0.5) * 0.2))),
    tone: r() * 15,
    synergy: 0.3 + r() * 0.5,
    slowness: 0.18 + r() * 0.3,
    tremorAmp: r() < 0.2 ? r() * 3 : 0,
    tremorHz: 4 + r() * 3,
    trajectory,
    gain8: 0.15 + r() * 0.25,
  };
}

/** Range fraction for one finger in a given week (0..8, fractional). */
export function rangeAt(p: PatientParams, finger: number, week: number): number {
  const r0 = p.range0[finger];
  const w = Math.max(0, week);
  let g = 0;
  switch (p.trajectory) {
    case 'steady':
      g = p.gain8 * Math.min(w, 8) / 8;
      break;
    case 'plateau':
      g = p.gain8 * (1 - Math.exp(-w / 1.5));
      break;
    case 'relapse':
      g = w < 4 ? p.gain8 * (w / 4) : p.gain8 * (1 - (w - 4) / 4) - 0.05 * (w - 4) / 4;
      break;
    case 'none':
      g = 0;
  }
  return Math.min(1, Math.max(0.02, r0 + g));
}

/**
 * The pose a patient reaches when asked for `target`, per finger scaled toward
 * the patient's resting pose by its available range.
 */
export function achievedPose(p: PatientParams, target: HandAngles, week: number, out = neutralAngles()): HandAngles {
  const rest = patientRest(p);
  const s = [0, 1, 2, 3, 4].map((f) => rangeAt(p, f, week));
  out.thumb.cmcFlex = rest.thumb.cmcFlex + (target.thumb.cmcFlex - rest.thumb.cmcFlex) * s[0];
  out.thumb.cmcAbd = rest.thumb.cmcAbd + (target.thumb.cmcAbd - rest.thumb.cmcAbd) * s[0];
  out.thumb.mcpFlex = rest.thumb.mcpFlex + (target.thumb.mcpFlex - rest.thumb.mcpFlex) * s[0];
  out.thumb.ipFlex = rest.thumb.ipFlex + (target.thumb.ipFlex - rest.thumb.ipFlex) * s[0];
  for (let f = 0; f < 4; f++) {
    const t = target.fingers[f];
    const r = rest.fingers[f];
    const o = out.fingers[f];
    const k = s[f + 1];
    o.mcpFlex = r.mcpFlex + (t.mcpFlex - r.mcpFlex) * k;
    o.mcpAbd = r.mcpAbd + (t.mcpAbd - r.mcpAbd) * k;
    o.pipFlex = r.pipFlex + (t.pipFlex - r.pipFlex) * k;
    o.dipFlex = r.dipFlex + (t.dipFlex - r.dipFlex) * k;
  }
  return out;
}

export function patientRest(p: PatientParams): HandAngles {
  const a = restAngles();
  a.fingers.forEach((f) => {
    f.mcpFlex += p.tone;
    f.pipFlex += p.tone * 1.3;
    f.dipFlex += p.tone * 0.6;
  });
  return a;
}

/** Ground-truth total active motion per finger (index..little) for a patient in a week. */
export function trueTam(p: PatientParams, week: number): number[] {
  const fist = achievedPose(p, fistAngles(), week);
  const open = achievedPose(p, openAngles(), week);
  return fist.fingers.map((f, i) => {
    const o = open.fingers[i];
    const flex = f.mcpFlex + f.pipFlex + f.dipFlex;
    const def = Math.max(0, o.mcpFlex) + Math.max(0, o.pipFlex) + Math.max(0, o.dipFlex);
    return flex - def;
  });
}

/**
 * Time course of one trial: the hand moves from `from` toward `to` with a
 * first-order response, holds, and optional tremor rides on top.
 */
export function* trialFrames(
  p: PatientParams,
  from: HandAngles,
  to: HandAngles,
  seconds: number,
  fps: number,
  seed: number,
): Generator<{ t: number; angles: HandAngles }> {
  const r = rng(seed);
  const phase = r() * Math.PI * 2;
  const reaction = 0.25 + r() * 0.15;
  const dt = 1 / fps;
  const cur = cloneAngles(from);
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    const drive = t < reaction ? 0 : 1 - Math.exp(-(t - reaction) / p.slowness);
    lerpAngles(from, to, drive, cur);
    if (p.tremorAmp > 0) {
      const tr = p.tremorAmp * Math.sin(2 * Math.PI * p.tremorHz * t + phase);
      cur.fingers.forEach((f) => {
        f.mcpFlex += tr;
        f.pipFlex += tr * 0.6;
      });
    }
    yield { t, angles: cur };
  }
}

/** Target pose for pressing one finger (index..little) with others resting. */
export function pressTarget(p: PatientParams, finger: number): HandAngles {
  const rest = patientRest(p);
  const t = cloneAngles(rest);
  const fist = fistAngles();
  t.fingers[finger].mcpFlex = 55;
  t.fingers[finger].pipFlex = 40;
  // mass synergy drags the neighbours along
  for (let f = 0; f < 4; f++) {
    if (f === finger) continue;
    const spill = p.synergy * (f === finger - 1 || f === finger + 1 ? 1 : 0.6);
    t.fingers[f].mcpFlex = rest.fingers[f].mcpFlex + (55 - rest.fingers[f].mcpFlex) * spill;
    t.fingers[f].pipFlex = rest.fingers[f].pipFlex + (fist.fingers[f].pipFlex * 0.4 - rest.fingers[f].pipFlex) * spill;
  }
  return t;
}

export function noiseSeed(p: PatientParams, hand: number): number {
  return p.seed * 31 + hand * 1009 + 3;
}

export { gauss };
