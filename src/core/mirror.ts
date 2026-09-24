/**
 * Reflects a tracked hand across the body midline.
 *
 * A reflection turns a right hand into a left hand. Positions reflect as
 * points. For orientation, WebXR fixes +Y out of the back of the hand and -Z
 * along the bone for both hands, so the reflected Y and Z columns are already
 * correct for the mirrored hand; X is recomputed as Y x Z, which is the
 * negated reflection of X. No per-joint correction table is needed.
 */
import { JOINT_COUNT, Pose } from './joints.js';
import {
  cross3,
  dot3,
  norm3,
  projectOnPlane3,
  sub3,
  v3,
  Vec3,
  add3,
  scale3,
  len3,
} from './math.js';

export interface MirrorPlane {
  origin: Float64Array;
  /** Unit normal, horizontal, pointing from the Lead side to the Understudy side. */
  normal: Float64Array;
}

export function newPlane(): MirrorPlane {
  return { origin: v3(), normal: v3(1, 0, 0) };
}

const d = v3();

/**
 * The perpendicular bisector of the two palm centres, constrained vertical so
 * a hand resting on the table reflects onto the table.
 */
export function planeFromPalms(lead: Vec3, understudy: Vec3, up: Vec3, out: MirrorPlane): MirrorPlane {
  sub3(d, understudy, lead);
  projectOnPlane3(d, d, up);
  if (len3(d) < 1e-6) return out;
  norm3(out.normal, d);
  add3(out.origin, lead, understudy);
  scale3(out.origin, out.origin, 0.5);
  return out;
}

/** Moves the plane along its normal, for the manual fine-tune handle. */
export function nudgePlane(plane: MirrorPlane, metres: number): void {
  plane.origin[0] += plane.normal[0] * metres;
  plane.origin[1] += plane.normal[1] * metres;
  plane.origin[2] += plane.normal[2] * metres;
}

export function reflectPoint(out: Vec3, p: Vec3, plane: MirrorPlane): Vec3 {
  const n = plane.normal;
  const k = 2 * ((p[0] - plane.origin[0]) * n[0] + (p[1] - plane.origin[1]) * n[1] + (p[2] - plane.origin[2]) * n[2]);
  out[0] = p[0] - k * n[0];
  out[1] = p[1] - k * n[1];
  out[2] = p[2] - k * n[2];
  return out;
}

function reflectDir(out: Vec3, v: Vec3, n: Vec3): Vec3 {
  const k = 2 * dot3(v, n);
  out[0] = v[0] - k * n[0];
  out[1] = v[1] - k * n[1];
  out[2] = v[2] - k * n[2];
  return out;
}

const px = v3();
const py = v3();
const pz = v3();
const pp = v3();
const rx = v3();
const ry = v3();
const rz = v3();

/** Writes the mirror image of `src` into `out`. `src` and `out` may alias. */
export function mirrorPose(src: Pose, plane: MirrorPlane, out: Pose): Pose {
  const n = plane.normal;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 16;
    px[0] = src[o];
    px[1] = src[o + 1];
    px[2] = src[o + 2];
    py[0] = src[o + 4];
    py[1] = src[o + 5];
    py[2] = src[o + 6];
    pz[0] = src[o + 8];
    pz[1] = src[o + 9];
    pz[2] = src[o + 10];
    pp[0] = src[o + 12];
    pp[1] = src[o + 13];
    pp[2] = src[o + 14];
    reflectDir(ry, py, n);
    reflectDir(rz, pz, n);
    cross3(rx, ry, rz);
    reflectPoint(pp, pp, plane);
    out[o] = rx[0];
    out[o + 1] = rx[1];
    out[o + 2] = rx[2];
    out[o + 3] = 0;
    out[o + 4] = ry[0];
    out[o + 5] = ry[1];
    out[o + 6] = ry[2];
    out[o + 7] = 0;
    out[o + 8] = rz[0];
    out[o + 9] = rz[1];
    out[o + 10] = rz[2];
    out[o + 11] = 0;
    out[o + 12] = pp[0];
    out[o + 13] = pp[1];
    out[o + 14] = pp[2];
    out[o + 15] = 1;
  }
  return out;
}

/** Translates every joint of a pose by `delta`. */
export function translatePose(pose: Pose, delta: Vec3, out: Pose = pose): Pose {
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 16;
    if (out !== pose) for (let i = 0; i < 12; i++) out[o + i] = pose[o + i];
    out[o + 12] = pose[o + 12] + delta[0];
    out[o + 13] = pose[o + 13] + delta[1];
    out[o + 14] = pose[o + 14] + delta[2];
    out[o + 15] = 1;
  }
  return out;
}
