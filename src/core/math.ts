/**
 * Allocation-free vector, quaternion and matrix helpers over plain arrays.
 *
 * The core library stays independent of Three.js so it runs unchanged in the
 * browser, in Node tests and in the simulation scripts. Matrices are 4x4,
 * column-major, the layout WebXR `fillPoses` writes. Quaternions are [x, y, z, w].
 */

export type Vec3 = Float64Array | number[];
export type Quat = Float64Array | number[];
export type Mat4 = Float32Array | Float64Array | number[];

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

export function v3(x = 0, y = 0, z = 0): Float64Array {
  const out = new Float64Array(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function q4(x = 0, y = 0, z = 0, w = 1): Float64Array {
  const out = new Float64Array(4);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  out[3] = w;
  return out;
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

export function copy3(out: Vec3, a: Vec3): Vec3 {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

export function add3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

export function sub3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

export function scale3(out: Vec3, a: Vec3, s: number): Vec3 {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

export function addScaled3(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out[0] = a[0] + b[0] * s;
  out[1] = a[1] + b[1] * s;
  out[2] = a[2] + b[2] * s;
  return out;
}

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function len3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function norm3(out: Vec3, a: Vec3): Vec3 {
  const l = len3(a);
  if (l < 1e-12) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return out;
  }
  return scale3(out, a, 1 / l);
}

export function lerp3(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** Removes the component of `a` along unit vector `n`. */
export function projectOnPlane3(out: Vec3, a: Vec3, n: Vec3): Vec3 {
  const d = dot3(a, n);
  out[0] = a[0] - n[0] * d;
  out[1] = a[1] - n[1] * d;
  out[2] = a[2] - n[2] * d;
  return out;
}

/**
 * Signed angle in radians from `a` to `b` about unit `axis`, after projecting
 * both onto the plane perpendicular to the axis.
 */
export function signedAngleAbout(a: Vec3, b: Vec3, axis: Vec3, tmpA: Vec3, tmpB: Vec3, tmpC: Vec3): number {
  projectOnPlane3(tmpA, a, axis);
  projectOnPlane3(tmpB, b, axis);
  cross3(tmpC, tmpA, tmpB);
  return Math.atan2(dot3(tmpC, axis), dot3(tmpA, tmpB));
}

/** Unsigned angle in radians between two vectors. */
export function angle3(a: Vec3, b: Vec3): number {
  const la = len3(a);
  const lb = len3(b);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = dot3(a, b) / (la * lb);
  return Math.acos(Math.min(1, Math.max(-1, c)));
}

// ---------------------------------------------------------------- matrices

export function mat4Identity(out: Mat4, o = 0): Mat4 {
  for (let i = 0; i < 16; i++) out[o + i] = i % 5 === 0 ? 1 : 0;
  return out;
}

export function getPos(out: Vec3, m: Mat4, o = 0): Vec3 {
  out[0] = m[o + 12];
  out[1] = m[o + 13];
  out[2] = m[o + 14];
  return out;
}

/** Reads basis column `c` (0 = X, 1 = Y, 2 = Z) of the matrix at offset `o`. */
export function getAxis(out: Vec3, m: Mat4, c: number, o = 0): Vec3 {
  out[0] = m[o + c * 4];
  out[1] = m[o + c * 4 + 1];
  out[2] = m[o + c * 4 + 2];
  return out;
}

export function composeMat4(out: Mat4, p: Vec3, q: Quat, o = 0): Mat4 {
  const x = q[0];
  const y = q[1];
  const z = q[2];
  const w = q[3];
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  out[o + 0] = 1 - (yy + zz);
  out[o + 1] = xy + wz;
  out[o + 2] = xz - wy;
  out[o + 3] = 0;
  out[o + 4] = xy - wz;
  out[o + 5] = 1 - (xx + zz);
  out[o + 6] = yz + wx;
  out[o + 7] = 0;
  out[o + 8] = xz + wy;
  out[o + 9] = yz - wx;
  out[o + 10] = 1 - (xx + yy);
  out[o + 11] = 0;
  out[o + 12] = p[0];
  out[o + 13] = p[1];
  out[o + 14] = p[2];
  out[o + 15] = 1;
  return out;
}

/** Extracts the rotation of an orthonormal matrix at offset `o` as a quaternion. */
export function quatFromMat4(out: Quat, m: Mat4, o = 0): Quat {
  const m11 = m[o + 0];
  const m12 = m[o + 4];
  const m13 = m[o + 8];
  const m21 = m[o + 1];
  const m22 = m[o + 5];
  const m23 = m[o + 9];
  const m31 = m[o + 2];
  const m32 = m[o + 6];
  const m33 = m[o + 10];
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    out[3] = 0.25 / s;
    out[0] = (m32 - m23) * s;
    out[1] = (m13 - m31) * s;
    out[2] = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    out[3] = (m32 - m23) / s;
    out[0] = 0.25 * s;
    out[1] = (m12 + m21) / s;
    out[2] = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    out[3] = (m13 - m31) / s;
    out[0] = (m12 + m21) / s;
    out[1] = 0.25 * s;
    out[2] = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    out[3] = (m21 - m12) / s;
    out[0] = (m13 + m31) / s;
    out[1] = (m23 + m32) / s;
    out[2] = 0.25 * s;
  }
  return quatNormalize(out, out);
}

/** Builds a rotation matrix from three orthonormal basis columns and a position. */
export function basisMat4(out: Mat4, x: Vec3, y: Vec3, z: Vec3, p: Vec3, o = 0): Mat4 {
  out[o + 0] = x[0];
  out[o + 1] = x[1];
  out[o + 2] = x[2];
  out[o + 3] = 0;
  out[o + 4] = y[0];
  out[o + 5] = y[1];
  out[o + 6] = y[2];
  out[o + 7] = 0;
  out[o + 8] = z[0];
  out[o + 9] = z[1];
  out[o + 10] = z[2];
  out[o + 11] = 0;
  out[o + 12] = p[0];
  out[o + 13] = p[1];
  out[o + 14] = p[2];
  out[o + 15] = 1;
  return out;
}

/** Multiplies two affine column-major matrices: out = a * b. */
export function mulMat4(out: Mat4, a: Mat4, b: Mat4, oo = 0, oa = 0, ob = 0): Mat4 {
  const t = TMP16;
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[oa + k * 4 + r] * b[ob + c * 4 + k];
      t[c * 4 + r] = s;
    }
  }
  for (let i = 0; i < 16; i++) out[oo + i] = t[i];
  return out;
}

/** Inverts a rigid (rotation + translation) matrix. */
export function invertRigid(out: Mat4, m: Mat4, oo = 0, om = 0): Mat4 {
  const t = TMP16;
  // transpose rotation
  t[0] = m[om + 0];
  t[1] = m[om + 4];
  t[2] = m[om + 8];
  t[3] = 0;
  t[4] = m[om + 1];
  t[5] = m[om + 5];
  t[6] = m[om + 9];
  t[7] = 0;
  t[8] = m[om + 2];
  t[9] = m[om + 6];
  t[10] = m[om + 10];
  t[11] = 0;
  const px = m[om + 12];
  const py = m[om + 13];
  const pz = m[om + 14];
  t[12] = -(t[0] * px + t[4] * py + t[8] * pz);
  t[13] = -(t[1] * px + t[5] * py + t[9] * pz);
  t[14] = -(t[2] * px + t[6] * py + t[10] * pz);
  t[15] = 1;
  for (let i = 0; i < 16; i++) out[oo + i] = t[i];
  return out;
}

export function transformPoint(out: Vec3, m: Mat4, p: Vec3, o = 0): Vec3 {
  const x = p[0];
  const y = p[1];
  const z = p[2];
  out[0] = m[o + 0] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12];
  out[1] = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13];
  out[2] = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
  return out;
}

export function transformDir(out: Vec3, m: Mat4, d: Vec3, o = 0): Vec3 {
  const x = d[0];
  const y = d[1];
  const z = d[2];
  out[0] = m[o + 0] * x + m[o + 4] * y + m[o + 8] * z;
  out[1] = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z;
  out[2] = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z;
  return out;
}

const TMP16 = new Float64Array(16);

// ------------------------------------------------------------- quaternions

export function quatNormalize(out: Quat, q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  out[0] = q[0] / l;
  out[1] = q[1] / l;
  out[2] = q[2] / l;
  out[3] = q[3] / l;
  return out;
}

export function quatMul(out: Quat, a: Quat, b: Quat): Quat {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const aw = a[3];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  const bw = b[3];
  out[0] = ax * bw + aw * bx + ay * bz - az * by;
  out[1] = ay * bw + aw * by + az * bx - ax * bz;
  out[2] = az * bw + aw * bz + ax * by - ay * bx;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

export function quatConj(out: Quat, q: Quat): Quat {
  out[0] = -q[0];
  out[1] = -q[1];
  out[2] = -q[2];
  out[3] = q[3];
  return out;
}

export function quatAxisAngle(out: Quat, axis: Vec3, angle: number): Quat {
  const h = angle / 2;
  const s = Math.sin(h);
  out[0] = axis[0] * s;
  out[1] = axis[1] * s;
  out[2] = axis[2] * s;
  out[3] = Math.cos(h);
  return out;
}

export function quatRotate(out: Vec3, q: Quat, v: Vec3): Vec3 {
  const qx = q[0];
  const qy = q[1];
  const qz = q[2];
  const qw = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  out[0] = vx + qw * tx + (qy * tz - qz * ty);
  out[1] = vy + qw * ty + (qz * tx - qx * tz);
  out[2] = vz + qw * tz + (qx * ty - qy * tx);
  return out;
}

/**
 * Spherical interpolation. `t` outside [0, 1] extrapolates along the same
 * great circle, which the amplification gain relies on.
 */
export function quatSlerp(out: Quat, a: Quat, b: Quat, t: number): Quat {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.99995) {
    out[0] = a[0] + (bx - a[0]) * t;
    out[1] = a[1] + (by - a[1]) * t;
    out[2] = a[2] + (bz - a[2]) * t;
    out[3] = a[3] + (bw - a[3]) * t;
    return quatNormalize(out, out);
  }
  const theta = Math.acos(Math.min(1, cos));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  out[0] = a[0] * wa + bx * wb;
  out[1] = a[1] * wa + by * wb;
  out[2] = a[2] * wa + bz * wb;
  out[3] = a[3] * wa + bw * wb;
  return quatNormalize(out, out);
}

/** Rotation angle in radians between two orientations. */
export function quatAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, d));
}

// -------------------------------------------------------------- statistics

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return NaN;
  const s = Array.from(values).sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

export function variance(values: ArrayLike<number>): number {
  const n = values.length;
  if (n < 2) return NaN;
  const m = mean(values);
  let s = 0;
  for (let i = 0; i < n; i++) s += (values[i] - m) ** 2;
  return s / (n - 1);
}

/** Deterministic PRNG (mulberry32) so simulations and replays are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample from a uniform generator (Box-Muller). */
export function gauss(r: () => number): number {
  let u = 0;
  while (u === 0) u = r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
