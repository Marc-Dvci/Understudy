import type { Handedness } from '../core/joints.js';

export interface Persona {
  weakRange: number[];
  weakSide: Handedness;
  drift: number;
  stiffness: number;
  stiffTau: number;
}

/** Shared deterministic actor parameters; these describe a simulation. */
export const DEMO_PERSONA: Persona = {
  weakRange: [0.45, 0.4, 0.35, 0.3, 0.25],
  weakSide: 'left',
  drift: 0.034,
  stiffness: 0.28,
  stiffTau: 2.2,
};
