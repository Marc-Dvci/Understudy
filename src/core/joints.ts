/**
 * The 25-joint hand skeleton defined by the WebXR Hand Input Module.
 *
 * A pose is a Float32Array of 25 column-major 4x4 matrices in one reference
 * space, exactly what `XRFrame.fillPoses` produces. Joint frames follow the
 * WebXR convention: -Z points from the joint toward the fingertip along the
 * bone, +Y points out of the back of the hand.
 */

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;

export type JointName = (typeof JOINT_NAMES)[number];
export const JOINT_COUNT = 25;
export const POSE_FLOATS = JOINT_COUNT * 16;

export type Handedness = 'left' | 'right';
export type Pose = Float32Array;

export const J = {
  wrist: 0,
  thumbMeta: 1,
  thumbProx: 2,
  thumbDist: 3,
  thumbTip: 4,
  indexMeta: 5,
  indexProx: 6,
  indexInter: 7,
  indexDist: 8,
  indexTip: 9,
  middleMeta: 10,
  middleProx: 11,
  middleInter: 12,
  middleDist: 13,
  middleTip: 14,
  ringMeta: 15,
  ringProx: 16,
  ringInter: 17,
  ringDist: 18,
  ringTip: 19,
  pinkyMeta: 20,
  pinkyProx: 21,
  pinkyInter: 22,
  pinkyDist: 23,
  pinkyTip: 24,
} as const;

/** Parent joint index for each joint; the wrist is the root. */
export const PARENT: readonly number[] = [
  -1, 0, 1, 2, 3, 0, 5, 6, 7, 8, 0, 10, 11, 12, 13, 0, 15, 16, 17, 18, 0, 20, 21, 22, 23,
];

/** Fingers in anatomical order. Index 0 is the thumb. */
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'] as const;
export type Finger = (typeof FINGERS)[number];
export const FINGER_COUNT = 5;

/** Joint indices of each finger chain from metacarpal to tip. */
export const CHAINS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
];

/** Which finger each joint belongs to (-1 for the wrist). */
export const JOINT_FINGER: readonly number[] = [
  -1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4,
];

export const FINGER_LABEL: Record<Finger, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Little',
};

export function newPose(): Pose {
  return new Float32Array(POSE_FLOATS);
}

export function copyPose(out: Pose, src: ArrayLike<number>): Pose {
  for (let i = 0; i < POSE_FLOATS; i++) out[i] = src[i];
  return out;
}

export function otherHand(h: Handedness): Handedness {
  return h === 'left' ? 'right' : 'left';
}
