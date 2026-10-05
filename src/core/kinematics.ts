/**
 * Clinical joint angles from a 25-joint pose.
 *
 * Angles come from joint positions only, so the result does not depend on how
 * a runtime orients its joint frames. Flexion is positive toward the palm;
 * hyperextension is negative.
 */
import { CHAINS, Handedness, J, Pose } from './joints.js';
import {
  angle3,
  cross3,
  DEG,
  dist3,
  dot3,
  norm3,
  projectOnPlane3,
  signedAngleAbout,
  sub3,
  v3,
  Vec3,
  len3,
  scale3,
  add3,
  getAxis,
  q4,
  quatAxisAngle,
  quatRotate,
  copy3,
} from './math.js';

export interface FingerKinematics {
  mcp: number;
  pip: number;
  dip: number;
  /** Radial deviation at the MCP in the palm plane, degrees. */
  abd: number;
  /** MCP + PIP + DIP flexion, degrees. */
  sum: number;
}

export interface ThumbKinematics {
  mcp: number;
  ip: number;
  /** Distance from the thumb tip to each Kapandji landmark, metres (1..10). */
  kapandji: number[];
}

export interface HandKinematics {
  valid: boolean;
  handedness: Handedness;
  /** Unit vector out of the back of the hand. */
  dorsal: Float64Array;
  /** Unit vector from wrist toward the middle knuckle. */
  forward: Float64Array;
  palmCenter: Float64Array;
  /** Index, middle, ring, little. */
  fingers: FingerKinematics[];
  thumb: ThumbKinematics;
  /** Summed chain length wrist to middle tip, metres. */
  handLength: number;
  /** Mean fingertip distance from the palm centre divided by hand length. */
  opening: number;
  /** Angle between index and little proximal phalanges in the palm plane, degrees. */
  spread: number;
  /** Index tip to little tip distance divided by hand length. */
  span: number;
  /** Thumb tip to index tip distance, metres. */
  pinchGap: number;
}

export function newKinematics(handedness: Handedness = 'right'): HandKinematics {
  const f = (): FingerKinematics => ({ mcp: 0, pip: 0, dip: 0, abd: 0, sum: 0 });
  return {
    valid: false,
    handedness,
    dorsal: v3(),
    forward: v3(),
    palmCenter: v3(),
    fingers: [f(), f(), f(), f()],
    thumb: { mcp: 0, ip: 0, kapandji: new Array(11).fill(0) },
    handLength: 0,
    opening: 0,
    spread: 0,
    span: 0,
    pinchGap: 0,
  };
}

// scratch vectors, module-local so per-frame use does not allocate
const P = Array.from({ length: 25 }, () => v3());
const a = v3();
const b = v3();
const c = v3();
const t0 = v3();
const t1 = v3();
const t2 = v3();
const b0 = v3();
const b1 = v3();
const b2 = v3();
const b3 = v3();
const axis = v3();
const negDorsal = v3();
const lm = v3();
const fd = v3();
const qa = q4();
const copyInto = copy3;

function readPositions(pose: Pose): void {
  for (let j = 0; j < 25; j++) {
    const o = j * 16;
    P[j][0] = pose[o + 12];
    P[j][1] = pose[o + 13];
    P[j][2] = pose[o + 14];
  }
}

/** Flexion angle from bone `u` to bone `w` about the lateral axis `ax`. */
function flexAbout(u: Vec3, w: Vec3, ax: Vec3): number {
  return signedAngleAbout(u, w, ax, t0, t1, t2) * DEG;
}

export function computeKinematics(pose: Pose, handedness: Handedness, out: HandKinematics): HandKinematics {
  readPositions(pose);
  out.handedness = handedness;

  // Palm normal. WebXR defines +Y of every joint as pointing out of the back
  // of the hand; the middle metacarpal sits flat in the palm, so its Y axis is
  // the dorsal direction. The position-based normal from the wrist and the
  // index and little knuckles is the fallback when a runtime reports no usable
  // orientation; it tilts with the palm arch, so it is not the default.
  getAxis(c, pose, 1, J.middleMeta * 16);
  const yLen = len3(c);
  if (yLen > 0.5 && yLen < 1.5) {
    norm3(out.dorsal, c);
  } else {
    sub3(a, P[J.indexProx], P[J.wrist]);
    sub3(b, P[J.pinkyProx], P[J.wrist]);
    cross3(c, a, b);
    if (len3(c) < 1e-9) {
      out.valid = false;
      return out;
    }
    norm3(out.dorsal, c);
    if (handedness === 'right') scale3(out.dorsal, out.dorsal, -1);
  }
  scale3(negDorsal, out.dorsal, -1);

  sub3(a, P[J.middleProx], P[J.wrist]);
  projectOnPlane3(a, a, out.dorsal);
  norm3(out.forward, a);

  // palm centre: midpoint of wrist and the mean of the four knuckles
  a[0] = (P[J.indexProx][0] + P[J.middleProx][0] + P[J.ringProx][0] + P[J.pinkyProx][0]) / 4;
  a[1] = (P[J.indexProx][1] + P[J.middleProx][1] + P[J.ringProx][1] + P[J.pinkyProx][1]) / 4;
  a[2] = (P[J.indexProx][2] + P[J.middleProx][2] + P[J.ringProx][2] + P[J.pinkyProx][2]) / 4;
  add3(out.palmCenter, a, P[J.wrist]);
  scale3(out.palmCenter, out.palmCenter, 0.5);

  // hand length: wrist -> middle metacarpal -> ... -> tip
  let hl = dist3(P[J.wrist], P[J.middleMeta]);
  for (let j = J.middleMeta; j < J.middleTip; j++) hl += dist3(P[j], P[j + 1]);
  out.handLength = hl;

  // fingers
  let openSum = 0;
  for (let f = 1; f <= 4; f++) {
    const ch = CHAINS[f];
    sub3(b0, P[ch[1]], P[ch[0]]);
    sub3(b1, P[ch[2]], P[ch[1]]);
    sub3(b2, P[ch[3]], P[ch[2]]);
    sub3(b3, P[ch[4]], P[ch[3]]);
    const fk = out.fingers[f - 1];

    // The finger's own dorsal axis is +Y of its metacarpal joint; the ring and
    // little metacarpals tilt out of the palm plane with the palm arch, so
    // each finger is read in its own frame. Palm dorsal is the fallback.
    getAxis(fd, pose, 1, ch[0] * 16);
    const fl = len3(fd);
    if (fl > 0.5 && fl < 1.5) norm3(fd, fd);
    else copyInto(fd, out.dorsal);
    scale3(negDorsal, fd, -1);

    // Abduction is the proximal phalanx's deviation about that axis. Past
    // about 60 degrees of MCP flexion the phalanx points along the axis, the
    // projection no longer carries the angle, and the collateral ligaments
    // lock the joint anyway, so abduction is reported as zero there.
    const abdRaw = signedAngleAbout(b0, b1, fd, t0, t1, t2);
    const alongAxis = Math.abs(dot3(b1, fd)) / (len3(b1) || 1);
    const abdUsed = alongAxis < 0.85 ? abdRaw : 0;
    fk.abd = (handedness === 'right' ? abdUsed : -abdUsed) * DEG;

    // The flexion hinge is the lateral axis turned by the abduction, so MCP,
    // PIP and DIP are read about the axis the finger actually bends around.
    cross3(axis, b0, negDorsal);
    norm3(axis, axis);
    quatAxisAngle(qa, fd, abdUsed);
    quatRotate(axis, qa, axis);
    fk.mcp = flexAbout(b0, b1, axis);
    fk.pip = flexAbout(b1, b2, axis);
    fk.dip = flexAbout(b2, b3, axis);
    fk.sum = fk.mcp + fk.pip + fk.dip;

    openSum += dist3(P[ch[4]], out.palmCenter);
  }
  out.opening = hl > 0 ? openSum / 4 / hl : 0;

  // spread between index and little proximal phalanges in the palm plane
  sub3(a, P[J.indexInter], P[J.indexProx]);
  sub3(b, P[J.pinkyInter], P[J.pinkyProx]);
  projectOnPlane3(a, a, out.dorsal);
  projectOnPlane3(b, b, out.dorsal);
  out.spread = angle3(a, b) * DEG;
  out.span = hl > 0 ? dist3(P[J.indexTip], P[J.pinkyTip]) / hl : 0;
  out.pinchGap = dist3(P[J.thumbTip], P[J.indexTip]);

  // thumb flexion, unsigned
  sub3(b0, P[J.thumbProx], P[J.thumbMeta]);
  sub3(b1, P[J.thumbDist], P[J.thumbProx]);
  sub3(b2, P[J.thumbTip], P[J.thumbDist]);
  out.thumb.mcp = angle3(b0, b1) * DEG;
  out.thumb.ip = angle3(b1, b2) * DEG;
  kapandjiDistances(out.thumb.kapandji);

  out.valid = true;
  return out;
}

/**
 * Kapandji landmarks 1..10 approximated from the skeleton:
 * 1 index proximal phalanx, 2 index middle phalanx, 3 index tip, 4 middle tip,
 * 5 ring tip, 6 little tip, 7 little DIP, 8 little PIP, 9 little MCP,
 * 10 the palm below the little finger.
 */
function landmarkMidpoint(i: number, k: number): Vec3 {
  lm[0] = 0.5 * (P[i][0] + P[k][0]);
  lm[1] = 0.5 * (P[i][1] + P[k][1]);
  lm[2] = 0.5 * (P[i][2] + P[k][2]);
  return lm;
}

function kapandjiDistances(out: number[]): void {
  const tip = P[J.thumbTip];
  out[0] = 0;
  out[1] = dist3(tip, landmarkMidpoint(J.indexProx, J.indexInter));
  out[2] = dist3(tip, landmarkMidpoint(J.indexInter, J.indexDist));
  out[3] = dist3(tip, P[J.indexTip]);
  out[4] = dist3(tip, P[J.middleTip]);
  out[5] = dist3(tip, P[J.ringTip]);
  out[6] = dist3(tip, P[J.pinkyTip]);
  out[7] = dist3(tip, P[J.pinkyDist]);
  out[8] = dist3(tip, P[J.pinkyInter]);
  out[9] = dist3(tip, P[J.pinkyProx]);
  lm[0] = 0.6 * P[J.pinkyMeta][0] + 0.4 * P[J.pinkyProx][0];
  lm[1] = 0.6 * P[J.pinkyMeta][1] + 0.4 * P[J.pinkyProx][1];
  lm[2] = 0.6 * P[J.pinkyMeta][2] + 0.4 * P[J.pinkyProx][2];
  out[10] = dist3(tip, lm);
}

/** Highest Kapandji landmark the thumb tip reaches within `reach` metres. */
export function kapandjiScore(k: HandKinematics, reach = 0.022): number {
  let score = 0;
  for (let i = 1; i <= 10; i++) if (k.thumb.kapandji[i] <= reach) score = i;
  return score;
}

/**
 * Continuous thumb reach on the Kapandji scale: landmark i counts fully within
 * `reach` metres and fades to zero at `far`. A graded score changes smoothly
 * with the thumb, so tracker jitter moves it by fractions, not whole points.
 */
export function kapandjiContinuous(k: HandKinematics, reach = 0.022, far = 0.045): number {
  let score = 0;
  for (let i = 1; i <= 10; i++) {
    const d = k.thumb.kapandji[i];
    const s = d <= reach ? 1 : d >= far ? 0 : (far - d) / (far - reach);
    if (s > 0) score = Math.max(score, i - 1 + s);
  }
  return score;
}

/** Finger flexion values in a fixed order: index..little MCP, PIP, DIP. */
export function flatAngles(k: HandKinematics, out: number[]): number[] {
  let i = 0;
  for (const f of k.fingers) {
    out[i++] = f.mcp;
    out[i++] = f.pip;
    out[i++] = f.dip;
  }
  out[i++] = k.thumb.mcp;
  out[i++] = k.thumb.ip;
  return out;
}

export function dotDorsalUp(k: HandKinematics, up: Vec3): number {
  return dot3(k.dorsal, up);
}
