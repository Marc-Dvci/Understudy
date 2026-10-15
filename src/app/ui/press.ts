/**
 * One input model for every stone, built for hands that do not work the
 * standard way. Four ways to press, all equivalent:
 *  - poke: a fingertip reaches the stone's top, which sits on the real table;
 *  - dwell: a fingertip hovers over the stone for the user's dwell time;
 *  - thumb tap: while a stone is highlighted, the thumb taps the side of the
 *    index finger (a joint-based microgesture that works with small movement);
 *  - head gaze: looking at a stone for the dwell time, for users with neither
 *    hand usable.
 * Two optional extras: where the browser reports eye gaze as a transient
 * pointer (look, then pinch), the stone looked at when the pinch began is
 * pressed when it ends; and spoken labels press stones (voice commands).
 * No pinch is ever required.
 */
import { Vector3 } from '@iwsdk/core';
import { Handedness, J } from '../../core/joints.js';
import { dist3, v3 } from '../../core/math.js';
import { state } from '../state.js';
import { Stone } from './stone.js';

type PressListener = (id: string, how: PressMethod) => void;
export type PressMethod = 'poke' | 'dwell' | 'thumb' | 'gaze' | 'pointer' | 'eye' | 'voice';

/**
 * The stone a ray points at most directly, within `maxAngle` radians, or null.
 * Positions and the ray are in world space; `dir` need not be normalised.
 */
export function rayPick(stones: { id: string; x: number; y: number; z: number }[], origin: ArrayLike<number>, dir: ArrayLike<number>, maxAngle = 0.12): string | null {
  const dl = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(dl > 0)) return null;
  let best: string | null = null;
  let bestAngle = maxAngle;
  for (const s of stones) {
    const vx = s.x - origin[0], vy = s.y - origin[1], vz = s.z - origin[2];
    const vl = Math.hypot(vx, vy, vz);
    if (!(vl > 0)) continue;
    const c = (vx * dir[0] + vy * dir[1] + vz * dir[2]) / (vl * dl);
    const a = Math.acos(Math.max(-1, Math.min(1, c)));
    if (a < bestAngle) {
      bestAngle = a;
      best = s.id;
    }
  }
  return best;
}

const TIP_RADIUS = 0.009;
const REARM = 0.022;
const HOVER_HEIGHT = 0.07;
const HANDS: readonly Handedness[] = ['left', 'right'];

export class PressInput {
  private readonly stones = new Map<string, Stone>();
  private readonly listeners: PressListener[] = [];
  // a poke must start from above: a fingertip resting on the table never presses
  private armed: Record<Handedness, boolean> = { left: false, right: false };
  private readonly dwellTime = { left: new Map<string, number>(), right: new Map<string, number>() };
  private gazeTime = new Map<string, number>();
  private readonly active: Stone[] = [];
  private readonly pending = new Set<(reason: Error) => void>();
  /** Restrict input to Resume/Stop while a session is paused. */
  allowedIds: ReadonlySet<string> | null = null;
  private thumbState: Record<Handedness, { closedAt: number; closed: boolean }> = {
    left: { closedAt: -1, closed: false },
    right: { closedAt: -1, closed: false },
  };
  private readonly world = new Vector3();
  private readonly tip = v3();
  private readonly side = v3();
  private cooldown = 0;
  gazeEnabled = false;
  /** Seconds of no hand tracking after which head gaze switches on by itself. */
  gazeAutoAfter = 6;
  focused: string | null = null;
  lastMethod: PressMethod | null = null;

  add(stone: Stone): Stone {
    this.stones.set(stone.id, stone);
    return stone;
  }

  get(id: string): Stone | undefined {
    return this.stones.get(id);
  }

  onPress(fn: PressListener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Resolves with the id of the first of `ids` pressed. */
  wait(ids: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const cancel = (reason: Error) => { off(); this.pending.delete(cancel); reject(reason); };
      const off = this.onPress((id) => {
        if (ids.includes(id)) {
          off();
          this.pending.delete(cancel);
          resolve(id);
        }
      });
      this.pending.add(cancel);
    });
  }

  cancelPending(reason: Error): void {
    for (const cancel of this.pending) cancel(reason);
  }

  reset(): void {
    this.dwellTime.left.clear();
    this.dwellTime.right.clear();
    this.gazeTime.clear();
    this.armed.left = this.armed.right = false;
    this.focused = null;
    for (const s of this.stones.values()) s.dwell = 0;
  }

  press(id: string, how: PressMethod): void {
    const s = this.stones.get(id);
    if (!s || !s.enabled || !s.shown || this.cooldown > 0 || (this.allowedIds && !this.allowedIds.has(id))) return;
    s.pressed = 1;
    this.cooldown = 0.35;
    this.lastMethod = how;
    this.reset();
    for (const fn of [...this.listeners]) fn(id, how);
  }

  update(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const active = this.active;
    active.length = 0;
    for (const s of this.stones.values()) {
      s.hover = 0;
      s.update(dt);
      if (s.shown && s.enabled && (!this.allowedIds || this.allowedIds.has(s.id))) active.push(s);
      else { this.dwellTime.left.delete(s.id); this.dwellTime.right.delete(s.id); this.gazeTime.delete(s.id); }
    }
    let focus: string | null = null;
    let bestHover = 0;
    const dwellSeconds = state.profile.dwellSeconds;

    for (const h of HANDS) {
      const hand = state.hands[h];
      if (!hand.valid) {
        this.dwellTime[h].clear();
        this.armed[h] = false;
        this.thumbState[h].closed = false;
        continue;
      }
      const t = hand.indexTip;
      let lowest = Infinity;
      for (const s of active) {
        s.group.getWorldPosition(this.world);
        const dh = Math.hypot(t[0] - this.world.x, t[2] - this.world.z);
        const hgt = t[1] - TIP_RADIUS - (this.world.y + s.topHeight * s.group.scale.y);
        if (dh < s.radius * 1.15 && hgt >= -0.035 && hgt < HOVER_HEIGHT) {
          const hv = 1 - Math.max(0, hgt) / HOVER_HEIGHT;
          s.hover = Math.max(s.hover, hv);
          if (hv > bestHover) {
            bestHover = hv;
            focus = s.id;
          }
          lowest = Math.min(lowest, hgt);
          // poke
          if (this.armed[h] && hgt <= 0.002 && dh < s.radius * 1.05 && hand.indexTipSpeed > 0.02) {
            this.armed[h] = false;
            this.press(s.id, 'poke');
            return;
          }
          // dwell: a fingertip held over the stone
          if (hgt < 0.045 && hand.indexTipSpeed < 0.08) {
            const d = (this.dwellTime[h].get(s.id) ?? 0) + dt;
            this.dwellTime[h].set(s.id, d);
            s.dwell = Math.min(1, d / dwellSeconds);
            if (d >= dwellSeconds) {
              this.press(s.id, 'dwell');
              return;
            }
          } else {
            this.dwellTime[h].delete(s.id);
          }
        } else this.dwellTime[h].delete(s.id);
      }
      if (lowest > REARM) this.armed[h] = true;

      // thumb tap on the side of the index finger confirms the focused stone
      const ts = this.thumbState[h];
      this.side[0] = (hand.pose[J.indexProx * 16 + 12] + hand.pose[J.indexInter * 16 + 12]) / 2;
      this.side[1] = (hand.pose[J.indexProx * 16 + 13] + hand.pose[J.indexInter * 16 + 13]) / 2;
      this.side[2] = (hand.pose[J.indexProx * 16 + 14] + hand.pose[J.indexInter * 16 + 14]) / 2;
      const gap = dist3(hand.thumbTip, this.side);
      if (!ts.closed && gap < 0.016) {
        ts.closed = true;
        ts.closedAt = state.time;
      } else if (ts.closed && gap > 0.028) {
        ts.closed = false;
        const tapFocus = focus;
        if (state.time - ts.closedAt < 0.45 && tapFocus) {
          this.press(tapFocus, 'thumb');
          return;
        }
      }
    }
    for (const s of active) if (s.hover === 0) s.dwell = Math.max(0, s.dwell - dt * 2);

    // eye gaze with a pinch (WebXR transient pointer): the stone looked at
    // when the pinch starts is pressed when it ends
    const eye = state.transient;
    if (eye.active && !this.eyeWasActive) this.eyeLocked = this.eyeTarget(active, eye.origin, eye.dir);
    if (this.eyeLocked) {
      const s = this.stones.get(this.eyeLocked);
      if (s && active.includes(s)) {
        s.hover = Math.max(s.hover, 0.8);
        focus = focus ?? s.id;
      }
    }
    if (!eye.active && this.eyeWasActive && this.eyeLocked) {
      const id = this.eyeLocked;
      this.eyeLocked = null;
      this.eyeWasActive = false;
      this.press(id, 'eye');
      return;
    }
    this.eyeWasActive = eye.active;
    if (!eye.active) this.eyeLocked = null;

    // head gaze
    const noHands = Math.min(state.hands.left.lostFor, state.hands.right.lostFor) > this.gazeAutoAfter;
    if (this.gazeEnabled || noHands) {
      const gazed = this.gazeTarget(active);
      for (const s of active) {
        if (s.id === gazed) {
          const g = (this.gazeTime.get(s.id) ?? 0) + dt;
          this.gazeTime.set(s.id, g);
          s.hover = Math.max(s.hover, 0.6);
          s.dwell = Math.min(1, g / (dwellSeconds + 0.4));
          focus = focus ?? s.id;
          if (g >= dwellSeconds + 0.4) {
            this.press(s.id, 'gaze');
            return;
          }
        } else {
          this.gazeTime.set(s.id, 0);
        }
      }
    } else this.gazeTime.clear();
    this.focused = focus;
  }

  private eyeWasActive = false;
  private eyeLocked: string | null = null;

  private eyeTarget(active: Stone[], origin: ArrayLike<number>, dir: ArrayLike<number>): string | null {
    return rayPick(active.map((s) => {
      s.group.getWorldPosition(this.world);
      return { id: s.id, x: this.world.x, y: this.world.y, z: this.world.z };
    }), origin, dir);
  }

  private readonly gazeDir = new Vector3();
  private readonly gazeOrigin = new Vector3();

  private gazeTarget(active: Stone[]): string | null {
    const cam = this.camera;
    if (!cam) return null;
    cam.getWorldPosition(this.gazeOrigin);
    cam.getWorldDirection(this.gazeDir);
    let best: string | null = null;
    let bestAngle = 0.09;
    for (const s of active) {
      s.group.getWorldPosition(this.world);
      this.world.sub(this.gazeOrigin);
      const a = this.world.angleTo(this.gazeDir);
      if (a < bestAngle) {
        bestAngle = a;
        best = s.id;
      }
    }
    return best;
  }

  camera: { getWorldPosition(v: Vector3): Vector3; getWorldDirection(v: Vector3): Vector3 } | null = null;

  all(): Stone[] {
    return [...this.stones.values()];
  }

  hideAll(): void {
    for (const s of this.stones.values()) s.hide();
    this.reset();
  }
}
