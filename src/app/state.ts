/**
 * Shared per-frame state. Systems write the parts they own and read the rest.
 * Poses are 25 column-major matrices in world space.
 */
import { Handedness, newPose, Pose } from '../core/joints.js';
import { GmiStage } from '../core/gmi.js';
import { HandKinematics, newKinematics } from '../core/kinematics.js';
import { MirrorPlane, newPlane } from '../core/mirror.js';
import { defaultProfile, Profile } from '../core/records.js';
import { FingerControl, newControls } from '../core/rehearse.js';
import { v3 } from '../core/math.js';

export interface TrackedHand {
  handedness: Handedness;
  /** World-space joint poses from the latest frame with tracking. */
  pose: Pose;
  kin: HandKinematics;
  /** True when this frame delivered a full, plausible skeleton. */
  valid: boolean;
  /** Seconds since tracking was last valid. */
  lostFor: number;
  /** Bone lengths calibrated in the first valid seconds, for the plausibility check. */
  boneLengths: Float64Array;
  boneSamples: number;
  indexTip: Float64Array;
  thumbTip: Float64Array;
  /** Velocity of the index tip, m/s, for the poke press detector. */
  indexTipSpeed: number;
}

function newTracked(h: Handedness): TrackedHand {
  return {
    handedness: h,
    pose: newPose(),
    kin: newKinematics(h),
    valid: false,
    lostFor: Infinity,
    boneLengths: new Float64Array(25),
    boneSamples: 0,
    indexTip: v3(),
    thumbTip: v3(),
    indexTipSpeed: 0,
  };
}

export interface Station {
  ready: boolean;
  /** Centre of the mat on the table surface. */
  center: Float64Array;
  /** Unit vector along the table away from the user. */
  forward: Float64Array;
  /** Unit vector to the user's right. */
  right: Float64Array;
  up: Float64Array;
  height: number;
  source: 'table-label' | 'mesh-label' | 'flat-hand' | 'lap' | 'none';
  /** Table extents when known, metres. */
  width: number;
  depth: number;
  anchored: boolean;
}

export interface MirrorState {
  active: boolean;
  plane: MirrorPlane;
  /** Where the Understudy hand rests under the cloth. */
  restPose: Pose;
  hasRest: boolean;
  /** Rendered Understudy hand. */
  renderPose: Pose;
  /** Lateral offset of the rendered hand from the hidden one, metres (embodiment check). */
  offset: number;
  controls: FingerControl[];
  /** 0..1 visibility of the virtual Understudy hand. */
  visibility: number;
  cloth: boolean;
}

export interface AppState {
  profile: Profile;
  hands: Record<Handedness, TrackedHand>;
  station: Station;
  mirror: MirrorState;
  /** Head position and forward (horizontal) in world space. */
  head: Float64Array;
  headForward: Float64Array;
  /** Running in the IWER emulator with synthetic hands. */
  emulated: boolean;
  /** Film recording (?film): boards show what a person's own session shows, without sample labels. */
  film: boolean;
  /** Film recording (?film&gmi=): the Phantom stage to show, whatever the history. */
  gmiStage: GmiStage | null;
  /** An eye-gaze ray reported as a WebXR transient pointer while a pinch is held, world space. */
  transient: { active: boolean; origin: Float64Array; dir: Float64Array };
  /** A controller is held instead of a tracked hand (hand tracking is then off on Quest). */
  controllers: boolean;
  immersive: boolean;
  time: number;
  /** Hand opening at today's fist and full open, from the Hand Print; exercises scale to it. */
  openingRange: Record<Handedness, { closed: number; open: number }>;
}

export const state: AppState = {
  profile: defaultProfile(),
  hands: { left: newTracked('left'), right: newTracked('right') },
  station: {
    ready: false,
    center: v3(),
    forward: v3(0, 0, -1),
    right: v3(1, 0, 0),
    up: v3(0, 1, 0),
    height: 0.74,
    source: 'none',
    width: 0,
    depth: 0,
    anchored: false,
  },
  mirror: {
    active: false,
    plane: newPlane(),
    restPose: newPose(),
    hasRest: false,
    renderPose: newPose(),
    offset: 0,
    controls: newControls(),
    visibility: 0,
    cloth: false,
  },
  head: v3(0, 1.2, 0),
  headForward: v3(0, 0, -1),
  emulated: false,
  film: false,
  gmiStage: null,
  transient: { active: false, origin: v3(), dir: v3(0, 0, -1) },
  controllers: false,
  immersive: false,
  time: 0,
  openingRange: { left: { closed: 0.42, open: 0.72 }, right: { closed: 0.42, open: 0.72 } },
};

export function leadHand(): Handedness {
  const u = state.profile.understudy ?? 'left';
  return u === 'left' ? 'right' : 'left';
}

export function understudyHand(): Handedness {
  return state.profile.understudy ?? 'left';
}
