/**
 * A scripted pair of hands for emulation, demos and film.
 *
 * Each hand is a procedural hand (handmodel.ts) animated between targets with
 * eased transitions. Scripts await `move`, `poke` and `wait`; time advances
 * only through `update(dt)`, so a run under virtual time is frame-exact and
 * repeatable.
 */
import { Handedness, J, newPose, Pose } from '../core/joints.js';
import {
  q4,
  Quat,
  quatAxisAngle,
  quatMul,
  quatRotate,
  quatSlerp,
  RAD,
  v3,
  Vec3,
  rng,
  gauss,
} from '../core/math.js';
import {
  buildPose,
  cloneAngles,
  HandAngles,
  lerpAngles,
  neutralAngles,
  restAngles,
} from './handmodel.js';

export type Ease = 'linear' | 'inOut' | 'out';

function ease(t: number, e: Ease): number {
  if (e === 'linear') return t;
  if (e === 'out') return 1 - (1 - t) * (1 - t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

interface Tween {
  fromAngles: HandAngles;
  toAngles: HandAngles | null;
  fromPos: Float64Array;
  toPos: Float64Array | null;
  fromQuat: Float64Array;
  toQuat: Float64Array | null;
  duration: number;
  elapsed: number;
  ease: Ease;
  resolve: () => void;
}

export class HandActor {
  readonly handedness: Handedness;
  length: number;
  angles: HandAngles = restAngles();
  readonly position: Float64Array;
  readonly orientation: Float64Array = q4();
  private tween: Tween | null = null;
  private readonly queue: (() => void)[] = [];
  readonly pose: Pose = newPose();
  /** Physiological micro-motion amplitude in metres; 0 for a perfectly still hand. */
  sway = 0.0012;
  visible = true;
  private readonly r: () => number;
  private phase: number;
  private readonly scratch = neutralAngles();

  constructor(handedness: Handedness, position: Vec3, length = 0.19, seed = 1) {
    this.handedness = handedness;
    this.length = length;
    this.position = v3(position[0], position[1], position[2]);
    this.r = rng(seed);
    this.phase = this.r() * Math.PI * 2;
  }

  get busy(): boolean {
    return this.tween !== null || this.queue.length > 0;
  }

  /** Animates toward any subset of angles, wrist position and orientation. */
  move(target: { angles?: HandAngles; position?: Vec3; orientation?: Quat }, seconds: number, e: Ease = 'inOut'): Promise<void> {
    return new Promise((resolve) => {
      const start = () => {
        this.tween = {
          fromAngles: cloneAngles(this.angles),
          toAngles: target.angles ? cloneAngles(target.angles) : null,
          fromPos: v3(this.position[0], this.position[1], this.position[2]),
          toPos: target.position ? v3(target.position[0], target.position[1], target.position[2]) : null,
          fromQuat: q4(this.orientation[0], this.orientation[1], this.orientation[2], this.orientation[3]),
          toQuat: target.orientation ? q4(target.orientation[0], target.orientation[1], target.orientation[2], target.orientation[3]) : null,
          duration: Math.max(1e-3, seconds),
          elapsed: 0,
          ease: e,
          resolve,
        };
      };
      if (this.tween) this.queue.push(start);
      else start();
    });
  }

  /** Holds the current pose for `seconds`. */
  wait(seconds: number): Promise<void> {
    return this.move({}, seconds, 'linear');
  }

  setImmediate(angles: HandAngles, position?: Vec3, orientation?: Quat): void {
    this.angles = cloneAngles(angles);
    if (position) {
      this.position[0] = position[0];
      this.position[1] = position[1];
      this.position[2] = position[2];
    }
    if (orientation) for (let i = 0; i < 4; i++) this.orientation[i] = orientation[i];
  }

  update(dt: number): void {
    const t = this.tween;
    if (t) {
      t.elapsed += dt;
      const k = ease(Math.min(1, t.elapsed / t.duration), t.ease);
      if (t.toAngles) lerpAngles(t.fromAngles, t.toAngles, k, this.angles);
      if (t.toPos) {
        for (let i = 0; i < 3; i++) this.position[i] = t.fromPos[i] + (t.toPos[i] - t.fromPos[i]) * k;
      }
      if (t.toQuat) quatSlerp(this.orientation, t.fromQuat, t.toQuat, k);
      if (t.elapsed >= t.duration) {
        this.tween = null;
        t.resolve();
        const next = this.queue.shift();
        if (next) next();
      }
    }
    this.phase += dt;
  }

  /** Builds the current pose, with a slow sub-millimetre sway so a still hand looks alive. */
  build(): Pose {
    const p = v3(
      this.position[0] + Math.sin(this.phase * 0.9) * this.sway,
      this.position[1] + Math.sin(this.phase * 0.6 + 1) * this.sway * 0.5,
      this.position[2] + Math.sin(this.phase * 0.7 + 2) * this.sway,
    );
    lerpAngles(this.angles, this.angles, 0, this.scratch);
    if (this.sway > 0) {
      for (const f of this.scratch.fingers) {
        f.mcpFlex += gauss(this.r) * 0.15;
        f.pipFlex += gauss(this.r) * 0.15;
      }
    }
    buildPose(this.scratch, this.handedness, { length: this.length }, { position: p, orientation: this.orientation }, this.pose);
    return this.pose;
  }

  /** Index fingertip offset from the wrist for given angles and orientation. */
  tipOffset(angles: HandAngles, orientation: Quat, out: Vec3): Vec3 {
    const tmp = buildPose(angles, this.handedness, { length: this.length }, { position: v3(), orientation });
    out[0] = tmp[J.indexTip * 16 + 12];
    out[1] = tmp[J.indexTip * 16 + 13];
    out[2] = tmp[J.indexTip * 16 + 14];
    return out;
  }
}

/** A pointing hand: index extended, other fingers curled. */
export function pointAngles(): HandAngles {
  const a = restAngles();
  a.fingers[0] = { mcpFlex: 5, mcpAbd: 0, pipFlex: 8, dipFlex: 4 };
  for (let f = 1; f < 4; f++) a.fingers[f] = { mcpFlex: 78, mcpAbd: 0, pipFlex: 95, dipFlex: 55 };
  a.thumb = { cmcFlex: 30, cmcAbd: 10, mcpFlex: 35, ipFlex: 25 };
  return a;
}

/**
 * Orientation of a hand that points down at a table from above and behind:
 * fingers along `forward`, pitched down by `pitchDeg`.
 */
export function pokeOrientation(forward: Vec3, pitchDeg: number): Float64Array {
  const yaw = Math.atan2(-forward[0], -forward[2]);
  const qYaw = quatAxisAngle(q4(), v3(0, 1, 0), yaw);
  const qPitch = quatAxisAngle(q4(), v3(1, 0, 0), -pitchDeg * RAD);
  return quatMul(q4(), qYaw, qPitch) as Float64Array;
}

export function palmDownOrientation(forward: Vec3, rollDeg = 0): Float64Array {
  const yaw = Math.atan2(-forward[0], -forward[2]);
  const qYaw = quatAxisAngle(q4(), v3(0, 1, 0), yaw);
  const qRoll = quatAxisAngle(q4(), v3(0, 0, 1), rollDeg * RAD);
  return quatMul(q4(), qYaw, qRoll) as Float64Array;
}

const thumbCache = new Map<string, HandAngles>();

/**
 * Angles that bring the thumb tip onto fingertip `finger` (0 index .. 3
 * little), found by a seeded random search with local refinement. Used by
 * scripted hands for thumb touches and index-thumb taps.
 */
export function thumbToFinger(handedness: 'left' | 'right', finger: number, length = 0.19): HandAngles {
  const key = `${handedness}-${finger}-${length.toFixed(3)}`;
  const hit = thumbCache.get(key);
  if (hit) return cloneAngles(hit);
  const tipJ = [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip][finger];
  const r = rng(700 + finger);
  const place = { position: v3(), orientation: q4() };
  const shape = { length };
  const dist = (a: HandAngles) => {
    const p = buildPose(a, handedness, shape, place);
    return Math.hypot(
      p[tipJ * 16 + 12] - p[J.thumbTip * 16 + 12],
      p[tipJ * 16 + 13] - p[J.thumbTip * 16 + 13],
      p[tipJ * 16 + 14] - p[J.thumbTip * 16 + 14],
    );
  };
  const make = (v: number[]) => {
    const a = restAngles();
    a.thumb = { cmcFlex: v[0], cmcAbd: v[1], mcpFlex: v[2], ipFlex: v[3] };
    a.fingers[finger] = { mcpFlex: v[4], mcpAbd: 0, pipFlex: v[5], dipFlex: v[6] };
    return a;
  };
  const lo = [-10, 0, 0, 0, 0, 0, 0];
  const hi = [80, 70, 70, 80, 85, 100, 70];
  let best = [30, 30, 30, 30, 40, 50, 30];
  let bestD = dist(make(best));
  for (let i = 0; i < 2500; i++) {
    const v = lo.map((l, k) => l + r() * (hi[k] - l));
    const d = dist(make(v));
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  for (let step = 12; step > 0.2; step *= 0.7) {
    for (let it = 0; it < 60; it++) {
      const v = best.map((x, k) => Math.min(hi[k], Math.max(lo[k], x + (r() * 2 - 1) * step)));
      const d = dist(make(v));
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
  }
  const out = make(best);
  thumbCache.set(key, out);
  return cloneAngles(out);
}

/** Wrist position that puts the index tip of `angles` at `target`. */
export function wristForTip(actor: HandActor, angles: HandAngles, orientation: Quat, target: Vec3): Float64Array {
  const off = actor.tipOffset(angles, orientation, v3());
  return v3(target[0] - off[0], target[1] - off[1], target[2] - off[2]);
}

export { quatRotate };
