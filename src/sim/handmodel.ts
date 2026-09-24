/**
 * Procedural hand: explicit joint angles in, a 25-joint WebXR pose out.
 *
 * This is the ground truth for every simulated check. It builds left and right
 * hands directly from anatomy, without calling the mirror code, so the mirror
 * can be tested against it independently. Segment lengths are fractions of
 * hand length after Buchholz, Armstrong and Goldstein (1992).
 */
import {
  CHAINS,
  FINGER_COUNT,
  Handedness,
  J,
  newPose,
  Pose,
} from '../core/joints.js';
import {
  basisMat4,
  cross3,
  norm3,
  quatAxisAngle,
  quatMul,
  quatRotate,
  RAD,
  Vec3,
  v3,
  q4,
  Quat,
} from '../core/math.js';

/** Joint angles in degrees. Flexion is positive toward the palm. */
export interface FingerAngles {
  mcpFlex: number;
  /** Radial deviation at the MCP, positive away from the little finger. */
  mcpAbd: number;
  pipFlex: number;
  dipFlex: number;
}

export interface ThumbAngles {
  /** Rotation of the thumb metacarpal across the palm (opposition). */
  cmcFlex: number;
  /** Palmar abduction: the thumb lifting away from the palm plane. */
  cmcAbd: number;
  mcpFlex: number;
  ipFlex: number;
}

export interface HandAngles {
  thumb: ThumbAngles;
  /** Index, middle, ring, little. */
  fingers: [FingerAngles, FingerAngles, FingerAngles, FingerAngles];
}

export interface HandPlacement {
  /** Wrist position in the reference space, metres. */
  position: Vec3;
  /** Wrist orientation. Identity puts the palm down, fingers toward -Z. */
  orientation: Quat;
}

export interface HandShape {
  /** Wrist to middle fingertip, metres. */
  length: number;
}

const MC_LEN = [0.251, 0.374, 0.373, 0.336, 0.295];
const PROX_LEN = [0.196, 0.245, 0.266, 0.244, 0.204];
const INTER_LEN = [0, 0.143, 0.17, 0.165, 0.117];
const DIST_LEN = [0.158, 0.097, 0.108, 0.107, 0.093];

/** Metacarpal base offsets in hand units: [radial, palmar-down, distal]. */
const MC_BASE: readonly [number, number, number][] = [
  [0.1, -0.035, 0.07],
  [0.055, 0, 0.075],
  [0.012, 0, 0.08],
  [-0.03, -0.004, 0.075],
  [-0.068, -0.01, 0.065],
];
/** Metacarpal fan angle toward the radial side, degrees. */
const MC_FAN = [42, 7, 1, -5, -12];
/** Metacarpal droop toward the palm, degrees (the palm arch). */
const MC_DROOP = [28, 0, 0, 3, 6];

export function neutralAngles(): HandAngles {
  const f = (): FingerAngles => ({ mcpFlex: 0, mcpAbd: 0, pipFlex: 0, dipFlex: 0 });
  return {
    thumb: { cmcFlex: 0, cmcAbd: 0, mcpFlex: 0, ipFlex: 0 },
    fingers: [f(), f(), f(), f()],
  };
}

export function cloneAngles(a: HandAngles): HandAngles {
  return {
    thumb: { ...a.thumb },
    fingers: a.fingers.map((f) => ({ ...f })) as HandAngles['fingers'],
  };
}

/** A relaxed hand resting on a table. */
export function restAngles(): HandAngles {
  const a = neutralAngles();
  const rest = [12, 10, 14, 18];
  a.fingers.forEach((f, i) => {
    f.mcpFlex = rest[i];
    f.pipFlex = 18 + i * 3;
    f.dipFlex = 8 + i * 2;
  });
  a.thumb = { cmcFlex: 8, cmcAbd: 12, mcpFlex: 10, ipFlex: 8 };
  return a;
}

/** Full composite fist of a healthy hand. */
export function fistAngles(): HandAngles {
  const a = neutralAngles();
  a.fingers.forEach((f, i) => {
    f.mcpFlex = 88 + i * 2;
    f.pipFlex = 102;
    f.dipFlex = 68 + i;
  });
  a.thumb = { cmcFlex: 38, cmcAbd: 18, mcpFlex: 55, ipFlex: 70 };
  return a;
}

/** Fingers fully extended and spread. */
export function openAngles(): HandAngles {
  const a = neutralAngles();
  const spread = [12, 2, -8, -20];
  a.fingers.forEach((f, i) => {
    f.mcpFlex = -8;
    f.mcpAbd = spread[i];
    f.pipFlex = 0;
    f.dipFlex = 0;
  });
  a.thumb = { cmcFlex: -12, cmcAbd: 40, mcpFlex: 0, ipFlex: -5 };
  return a;
}

export function lerpAngles(a: HandAngles, b: HandAngles, t: number, out = neutralAngles()): HandAngles {
  const l = (x: number, y: number) => x + (y - x) * t;
  out.thumb.cmcFlex = l(a.thumb.cmcFlex, b.thumb.cmcFlex);
  out.thumb.cmcAbd = l(a.thumb.cmcAbd, b.thumb.cmcAbd);
  out.thumb.mcpFlex = l(a.thumb.mcpFlex, b.thumb.mcpFlex);
  out.thumb.ipFlex = l(a.thumb.ipFlex, b.thumb.ipFlex);
  for (let i = 0; i < 4; i++) {
    const fa = a.fingers[i];
    const fb = b.fingers[i];
    const fo = out.fingers[i];
    fo.mcpFlex = l(fa.mcpFlex, fb.mcpFlex);
    fo.mcpAbd = l(fa.mcpAbd, fb.mcpAbd);
    fo.pipFlex = l(fa.pipFlex, fb.pipFlex);
    fo.dipFlex = l(fa.dipFlex, fb.dipFlex);
  }
  return out;
}

const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const Z = v3(0, 0, 1);

/**
 * Builds a pose. Segment frames follow the WebXR convention: -Z along the bone
 * toward the tip, +Y out of the back of the finger, X = Y x Z.
 */
export function buildPose(
  angles: HandAngles,
  handedness: Handedness,
  shape: HandShape,
  placement: HandPlacement,
  out: Pose = newPose(),
): Pose {
  const L = shape.length;
  // radial direction in hand-local coordinates
  const radialX = handedness === 'right' ? -1 : 1;
  const qHand = placement.orientation;

  const toWorld = (local: Vec3, outV: Vec3) => {
    quatRotate(outV, qHand, local);
    outV[0] += placement.position[0];
    outV[1] += placement.position[1];
    outV[2] += placement.position[2];
    return outV;
  };

  const writeJoint = (index: number, posWorld: Vec3, frameLocal: Quat) => {
    const q = q4();
    quatMul(q, qHand, frameLocal);
    const xa = quatRotate(v3(), q, X);
    const ya = quatRotate(v3(), q, Y);
    const za = quatRotate(v3(), q, Z);
    basisMat4(out, xa, ya, za, posWorld, index * 16);
  };

  // wrist: identity frame in hand space
  writeJoint(J.wrist, placement.position, q4());

  for (let f = 0; f < FINGER_COUNT; f++) {
    const chain = CHAINS[f];
    const base = MC_BASE[f];
    const basePos = v3(base[0] * radialX * L, base[1] * L, -base[2] * L);

    // metacarpal frame: fan toward radial about Y, droop toward palm about X
    const fan = -MC_FAN[f] * RAD * radialX;
    const q = q4();
    quatAxisAngle(q, Y, fan);
    const droop = q4();
    quatAxisAngle(droop, X, -MC_DROOP[f] * RAD);
    quatMul(q, q, droop);

    if (f === 0) {
      // Thumb: pronate the thumb column so its nail faces outward, then
      // apply opposition (across the palm) and palmar abduction.
      const t = angles.thumb;
      const pron = q4();
      quatAxisAngle(pron, Z, -55 * RAD * radialX);
      quatMul(q, q, pron);
      const opp = q4();
      quatAxisAngle(opp, Y, t.cmcFlex * RAD * radialX);
      const abd = q4();
      quatAxisAngle(abd, X, -t.cmcAbd * RAD);
      const tmp = q4();
      quatMul(tmp, opp, q);
      quatMul(q, tmp, abd);
    }

    const pos = v3();
    const world = v3();
    const seg = v3();
    toWorld(basePos, world);
    writeJoint(chain[0], world, q);

    const lengths =
      f === 0
        ? [MC_LEN[0], PROX_LEN[0], DIST_LEN[0]]
        : [MC_LEN[f], PROX_LEN[f], INTER_LEN[f], DIST_LEN[f]];
    const flex =
      f === 0
        ? [angles.thumb.mcpFlex, angles.thumb.ipFlex]
        : [
            angles.fingers[f - 1].mcpFlex,
            angles.fingers[f - 1].pipFlex,
            angles.fingers[f - 1].dipFlex,
          ];
    const abdMcp = f === 0 ? 0 : angles.fingers[f - 1].mcpAbd;

    pos[0] = basePos[0];
    pos[1] = basePos[1];
    pos[2] = basePos[2];
    for (let s = 0; s < lengths.length; s++) {
      // advance along current segment (-Z of q)
      quatRotate(seg, q, Z);
      pos[0] -= seg[0] * lengths[s] * L;
      pos[1] -= seg[1] * lengths[s] * L;
      pos[2] -= seg[2] * lengths[s] * L;
      // rotate for the next segment at this joint
      if (s < flex.length) {
        if (s === 0 && abdMcp !== 0) {
          const qa = q4();
          quatAxisAngle(qa, Y, -abdMcp * RAD * radialX);
          quatMul(q, q, qa);
        }
        const qf = q4();
        quatAxisAngle(qf, X, -flex[s] * RAD);
        quatMul(q, q, qf);
      }
      toWorld(pos, world);
      writeJoint(chain[s + 1], world, q);
    }
  }
  return out;
}

/** Identity orientation: palm down, fingers pointing to -Z. */
export function palmDown(): Quat {
  return q4();
}

/** Orientation with the fingers pointing along `forward` on a table, palm down. */
export function palmDownFacing(forward: Vec3): Quat {
  const f = norm3(v3(), forward);
  const yaw = Math.atan2(-f[0], -f[2]);
  return quatAxisAngle(q4(), Y, yaw);
}

/** Convenience: cross product helper re-exported for tests. */
export function handNormalFromPose(pose: Pose, out: Vec3): Vec3 {
  const a = v3(pose[J.indexProx * 16 + 12] - pose[12], pose[J.indexProx * 16 + 13] - pose[13], pose[J.indexProx * 16 + 14] - pose[14]);
  const b = v3(pose[J.pinkyProx * 16 + 12] - pose[12], pose[J.pinkyProx * 16 + 13] - pose[13], pose[J.pinkyProx * 16 + 14] - pose[14]);
  return norm3(out, cross3(out, a, b));
}
