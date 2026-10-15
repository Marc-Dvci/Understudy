/**
 * Acts out each step in the emulator with a simulated user, for the in-browser
 * demo and for the film. The persona's left hand is weak (reduced range,
 * slower, poor finger independence); the right hand is healthy. Every
 * movement goes through the WebXR hand path, so the app measures the persona
 * exactly as it would measure a person.
 */
import { Vector3 } from '@iwsdk/core';
import { Handedness, J } from '../../core/joints.js';
import { gauss, q4, quatAxisAngle, quatMul, RAD, rng, v3, Vec3 } from '../../core/math.js';
import { HandActor, palmDownOrientation, pointAngles, pokeOrientation, thumbToFinger, wristForTip } from '../../sim/actor.js';
import {
  cloneAngles,
  fistAngles,
  HandAngles,
  lerpAngles,
  neutralAngles,
  openAngles,
  restAngles,
} from '../../sim/handmodel.js';
import { opposeAngles } from '../../sim/session.js';
import { Expect, flow, FlowInterrupted } from '../flow/engine.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { IwerHandDriver } from './iwer-driver.js';
import { DEMO_PERSONA, Persona } from '../../sim/persona.js';
export { DEMO_PERSONA } from '../../sim/persona.js';
export type { Persona } from '../../sim/persona.js';

export class Autopilot {
  readonly driver: IwerHandDriver;
  readonly actors: Record<Handedness, HandActor>;
  private current: Expect | null = null;
  private busy = false;
  private readonly r = rng(2026);
  private readonly persona: Persona;
  private readonly refFromWorld = new Float32Array(16);
  /** Seated head pose relative to the table. */
  head = v3(0.06, 1.16, -0.16);
  headPitch = -38;
  private tapPhase = 0;
  /** Set while a hand is turned or lifted by a looping exercise; the next step first returns it to rest. */
  private posed = false;
  /** Current warm-up repetition, -1 outside the warm-up. */
  private warmRep = -1;
  enabled = true;
  /** How the simulated user presses stones: poke, hover (dwell) or look (head gaze). */
  inputMode: 'poke' | 'dwell' | 'gaze' = 'poke';
  /** Regression fixture: remove one hand at the WebXR input-source boundary. */
  missingHand: Handedness | null = null;
  /** When set, the head turns to look at this world point instead of the mat. */
  private lookAt: Float64Array | null = null;
  private readonly tableY: number;
  private readonly tableCenter: Float64Array;

  /** Direction the seated user faces, horizontal unit vector. */
  readonly facing: Float64Array;

  constructor(driver: IwerHandDriver, tableCenter: Vec3, persona = DEMO_PERSONA, facing: Vec3 = v3(0, 0, -1)) {
    this.driver = driver;
    this.facing = v3(facing[0], 0, facing[2]);
    this.persona = persona;
    this.tableY = tableCenter[1];
    this.tableCenter = v3(tableCenter[0], tableCenter[1], tableCenter[2]);
    const f = this.facing;
    this.head = v3(tableCenter[0] - f[0] * 0.5, tableCenter[1] + 0.42, tableCenter[2] - f[2] * 0.5);
    this.actors = {
      left: new HandActor('left', v3(tableCenter[0], tableCenter[1] + 0.02, tableCenter[2]), 0.186, 11),
      right: new HandActor('right', v3(tableCenter[0], tableCenter[1] + 0.02, tableCenter[2]), 0.19, 12),
    };
    for (const h of ['left', 'right'] as Handedness[]) {
      const a = this.actors[h];
      a.setImmediate(this.restFor(h), this.restPosition(h), palmDownOrientation(this.facing, h === 'left' ? -4 : 4));
    }
  }

  /** Where a hand rests: the mat's resting place once the station exists, else on the table. */
  restPosition(h: Handedness): Float64Array {
    const s = state.station;
    const u = h === 'left' ? -0.16 : 0.16;
    let p: Float64Array;
    if (s.ready) {
      const w = stage.toWorld(u, -0.05, 0);
      p = v3(w.x, w.y, w.z);
    } else {
      // right = forward x up
      const f = this.facing;
      p = v3(this.tableCenter[0] - f[2] * u - f[0] * 0.12, this.tableY, this.tableCenter[2] + f[0] * u - f[2] * 0.12);
    }
    // wrist height that puts relaxed fingertips on the surface
    const a = this.actors?.[h];
    const drop = a ? this.tipDrop(a, this.restFor(h)) : 0.02;
    // the wrist sits behind the palm: shift toward the user by 9 cm
    const f = s.ready ? s.forward : this.facing;
    return v3(p[0] - f[0] * 0.09, p[1] + drop, p[2] - f[2] * 0.09);
  }

  private tipDrop(a: HandActor, angles: HandAngles): number {
    const pose = a.build();
    void pose;
    const o = palmDownOrientation(state.station.ready ? state.station.forward : this.facing);
    const tmp = new HandActor(a.handedness, v3(), a.length);
    tmp.setImmediate(angles, v3(), o);
    tmp.sway = 0;
    const p = tmp.build();
    let min = Infinity;
    for (const j of [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip, J.wrist]) min = Math.min(min, p[j * 16 + 13]);
    return -min + 0.0085;
  }

  restFor(h: Handedness): HandAngles {
    const a = restAngles();
    if (h === this.persona.weakSide) {
      a.fingers.forEach((f) => {
        f.mcpFlex += 8;
        f.pipFlex += 14;
      });
    }
    return a;
  }

  /** The pose a hand reaches when asked for `target`. */
  reach(h: Handedness, target: HandAngles): HandAngles {
    if (h !== this.persona.weakSide) return cloneAngles(target);
    const rest = this.restFor(h);
    const out = neutralAngles();
    const s = this.persona.weakRange;
    out.thumb.cmcFlex = rest.thumb.cmcFlex + (target.thumb.cmcFlex - rest.thumb.cmcFlex) * s[0];
    out.thumb.cmcAbd = rest.thumb.cmcAbd + (target.thumb.cmcAbd - rest.thumb.cmcAbd) * s[0];
    out.thumb.mcpFlex = rest.thumb.mcpFlex + (target.thumb.mcpFlex - rest.thumb.mcpFlex) * s[0];
    out.thumb.ipFlex = rest.thumb.ipFlex + (target.thumb.ipFlex - rest.thumb.ipFlex) * s[0];
    for (let f = 0; f < 4; f++) {
      const t = target.fingers[f];
      const r = rest.fingers[f];
      const k = s[f + 1];
      out.fingers[f] = {
        mcpFlex: r.mcpFlex + (t.mcpFlex - r.mcpFlex) * k,
        mcpAbd: r.mcpAbd + (t.mcpAbd - r.mcpAbd) * k,
        pipFlex: r.pipFlex + (t.pipFlex - r.pipFlex) * k,
        dipFlex: r.dipFlex + (t.dipFlex - r.dipFlex) * k,
      };
    }
    return out;
  }

  update(dt: number, playerMatrix: ArrayLike<number>): void {
    if (!this.enabled) return;
    invertRigid(this.refFromWorld, playerMatrix);
    this.driver.claim();
    // seated head, looking down at the table
    const f = state.station.ready ? state.station.forward : this.facing;
    let yaw = Math.atan2(-f[0], -f[2]);
    let pitch = this.headPitch * RAD;
    if (this.lookAt) {
      const dx = this.lookAt[0] - this.head[0];
      const dy = this.lookAt[1] - this.head[1];
      const dz = this.lookAt[2] - this.head[2];
      yaw = Math.atan2(-dx, -dz);
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
    const q = quatMul(q4(), quatAxisAngle(q4(), v3(0, 1, 0), yaw), quatAxisAngle(q4(), v3(1, 0, 0), pitch));
    this.driver.setHead(this.head[0], this.head[1], this.head[2], q);

    const e = flow.expect;
    if (e !== this.current && !this.busy) {
      this.current = e;
      void this.act(e).catch((error: unknown) => { if (!(error instanceof FlowInterrupted)) console.error('[understudy] demo failed', error); });
    }
    this.continuous(e, dt);
    for (const h of ['left', 'right'] as Handedness[]) {
      const a = this.actors[h];
      a.update(dt);
      this.driver.setHand(h, a.build(), this.refFromWorld);
      this.driver.setConnected(h, h !== this.missingHand);
    }
  }

  private async act(e: Expect): Promise<void> {
    this.busy = true;
    try {
      if (this.posed) {
        this.posed = false;
        await Promise.all((['left', 'right'] as Handedness[]).map((h) => this.toRest(h, 0.5)));
      }
      switch (e.kind) {
        case 'rest':
          await Promise.all((['left', 'right'] as Handedness[]).map((h) => this.toRest(h, 0.9)));
          break;
        case 'press':
          await this.poke(e.hand ?? this.pokeHand(), e.id);
          break;
        case 'warmup-fist':
          this.warmRep = e.rep;
          break;
        case 'move': {
          let target = e.movement === 'open' ? openAngles() : e.movement === 'fist' ? fistAngles() : e.movement === 'oppose' ? opposeAngles() : null;
          if (target && e.movement === 'fist' && e.rep !== undefined) {
            // stiff on the first fists of the morning, loosening as it warms
            const lost = this.persona.stiffness * Math.exp(-e.rep / this.persona.stiffTau);
            target = lerpAngles(this.restFor('right'), target, 1 - lost);
          }
          await Promise.all(
            e.hands.map((h) =>
              target
                ? this.actors[h].move({ angles: this.reach(h, target) }, h === this.persona.weakSide ? 0.9 : 0.55)
                : this.actors[h].move({ angles: this.restFor(h) }, 0.6),
            ),
          );
          break;
        }
        case 'touch': {
          const lead = leadHand();
          const truth = stage.hands.mirror ? this.hiddenTip() : null;
          if (!truth) break;
          const n = state.mirror.plane.normal;
          const shift = e.phase === 'post' ? this.persona.drift : 0.004;
          const target = v3(
            truth[0] + n[0] * shift + gauss(this.r) * 0.01,
            state.station.height + 0.004,
            truth[2] + n[2] * shift + gauss(this.r) * 0.01,
          );
          await this.pokeAt(lead, target);
          break;
        }
        case 'piano': {
          const h = leadHand();
          const rest = this.restFor(h);
          const t = cloneAngles(rest);
          t.fingers[e.finger].mcpFlex = rest.fingers[e.finger].mcpFlex + 38;
          t.fingers[e.finger].pipFlex = rest.fingers[e.finger].pipFlex + 26;
          await flow.wait(0.5 + this.r() * 0.3);
          await this.actors[h].move({ angles: t }, 0.35);
          await this.actors[h].move({ angles: rest }, 0.35);
          break;
        }
        case 'thumb-touch': {
          const h = leadHand();
          await flow.wait(0.3);
          await this.actors[h].move({ angles: thumbToFinger(h, e.finger, this.actors[h].length) }, 0.55);
          await this.actors[h].wait(0.25);
          await this.actors[h].move({ angles: this.restFor(h) }, 0.4);
          break;
        }
        case 'pinch-place': {
          const h = e.hand;
          const a = this.actors[h];
          const orient = pokeOrientation(state.station.forward, 30);
          const pinch = thumbToFinger(h, 0, a.length);
          const ready = lerpAngles(openAngles(), pinch, 0.35);
          const at = (p: number[], dy: number) => v3(p[0], p[1] + dy, p[2]);
          a.sway = 0;
          await flow.wait(0.3 + this.r() * 0.3);
          await a.move({ angles: ready, orientation: orient, position: wristForTip(a, pinch, orient, at(e.from, 0.06)) }, 0.7);
          await a.move({ position: wristForTip(a, pinch, orient, at(e.from, 0.002)) }, 0.35, 'out');
          await a.move({ angles: pinch }, 0.3);
          await a.wait(0.15);
          await a.move({ position: wristForTip(a, pinch, orient, at(e.from, 0.07)) }, 0.35);
          await a.move({ position: wristForTip(a, pinch, orient, at(e.to, 0.04)) }, 0.6);
          await a.move({ angles: ready }, 0.3);
          await a.wait(0.2);
          a.sway = 0.0012;
          await this.toRest(h, 0.6);
          break;
        }
        case 'residual-touch': {
          const h = leadHand();
          const side = understudyHand() === 'left' ? -1 : 1;
          const w = stage.toWorld(side * 0.17, -0.12, 0.004);
          await this.pokeAt(h, v3(w.x, w.y, w.z), 1.6);
          break;
        }
        default:
          break;
      }
    } finally {
      this.busy = false;
    }
  }

  resetWarmup(): void {
    this.warmRep = -1;
  }

  private pokeHand(): Handedness {
    if (this.missingHand) return this.missingHand === 'left' ? 'right' : 'left';
    return state.profile.understudy ? leadHand() : 'right';
  }

  private hiddenTip(): Float64Array | null {
    const p = state.mirror.restPose;
    return v3(p[J.indexTip * 16 + 12], p[J.indexTip * 16 + 13], p[J.indexTip * 16 + 14]);
  }

  private async toRest(h: Handedness, seconds: number): Promise<void> {
    const f = state.station.ready ? state.station.forward : this.facing;
    await this.actors[h].move(
      { angles: this.restFor(h), position: this.restPosition(h), orientation: palmDownOrientation(f, h === 'left' ? -4 : 4) },
      seconds,
    );
  }

  private async poke(h: Handedness, id: string): Promise<void> {
    await flow.wait(0.8 + this.r() * 0.4);
    const s = stage.press.get(id);
    if (!s) return;
    const w = s.group.getWorldPosition(new Vector3());
    if (this.inputMode === 'gaze') {
      // look at the stone until the gaze dwell presses it
      this.lookAt = v3(w.x, w.y, w.z);
      await flow.until(() => !s.shown || flow.expect.kind !== 'press', state.profile.dwellSeconds + 3);
      this.lookAt = null;
      return;
    }
    if (this.inputMode === 'dwell') {
      // hover the fingertip 2.5 cm above the stone and hold still
      const above = v3(w.x, w.y + s.height + 0.0095 + 0.025, w.z);
      const a = this.actors[h];
      const orient = pokeOrientation(state.station.forward, 38);
      const point = pointAngles();
      a.sway = 0;
      await a.move({ angles: point, orientation: orient, position: wristForTip(a, point, orient, above) }, 0.8);
      await flow.until(() => !s.shown || flow.expect.kind !== 'press', state.profile.dwellSeconds + 2);
      a.sway = 0.0012;
      await this.toRest(h, 0.6);
      return;
    }
    const top = v3(w.x, w.y + s.height + 0.0095 - 0.004, w.z);
    await this.pokeAt(h, top);
  }

  private async pokeAt(h: Handedness, target: Float64Array, hold = 0.18): Promise<void> {
    const a = this.actors[h];
    const f = state.station.ready ? state.station.forward : this.facing;
    const orient = pokeOrientation(f, 38);
    const point = pointAngles();
    const above = v3(target[0], target[1] + 0.06, target[2]);
    // lift off the table first, as a person does, so the fingertip never
    // brushes a nearer row of stones on its way to a farther one
    const p = a.position;
    await a.move({ position: v3(p[0], p[1] + 0.07, p[2]) }, 0.25);
    await a.move({ angles: point, orientation: orient, position: wristForTip(a, point, orient, above) }, 0.6);
    await a.move({ position: wristForTip(a, point, orient, target) }, 0.28, 'out');
    await a.wait(hold);
    await a.move({ position: wristForTip(a, point, orient, above) }, 0.25);
    await this.toRest(h, 0.7);
  }

  /** Movements that loop while a step lasts. */
  private continuous(e: Expect, dt: number): void {
    if (this.busy) return;
    const lead = leadHand();
    const a = this.actors[lead];
    if (e.kind === 'mirror-play') {
      this.tapPhase += dt;
      const rest = this.restFor(lead);
      if (e.style === 'open-close') {
        const k = 0.5 - 0.5 * Math.cos((this.tapPhase * 2 * Math.PI) / 2.6);
        const target = k < 0.5 ? lerpAngles(openAngles(), rest, k * 2) : lerpAngles(rest, fistAngles(), (k - 0.5) * 2);
        a.setImmediate(target);
      } else if (e.style === 'tap') {
        const k = Math.max(0, Math.sin((this.tapPhase * 2 * Math.PI) / 0.9));
        const t = cloneAngles(rest);
        t.fingers.forEach((fg) => {
          fg.mcpFlex = rest.fingers[0].mcpFlex - 18 * (1 - k) + 6;
        });
        a.setImmediate(t);
        a.position[1] = this.restPosition(lead)[1] + 0.012 * (1 - k);
      } else {
        const t = cloneAngles(rest);
        const finger = Math.floor(this.tapPhase / 0.7) % 4;
        const k = Math.sin(((this.tapPhase % 0.7) / 0.7) * Math.PI);
        t.fingers[finger].mcpFlex += 45 * k;
        t.fingers[finger].pipFlex += 40 * k;
        a.setImmediate(t);
      }
      // The short showcase compares the same movement with both simulated
      // hands moving. The original session actor remains Lead-only here.
      if (e.bothHands) {
        const weak = understudyHand();
        this.actors[weak].setImmediate(this.reach(weak, a.angles));
      }
    } else if (e.kind === 'tap-rhythm') {
      this.tapPhase += dt;
      for (const h of ['left', 'right'] as Handedness[]) {
        const pinch = thumbToFinger(h, 0, this.actors[h].length);
        const open = this.reach(h, openAngles());
        const k = 0.5 + 0.5 * Math.cos(this.tapPhase * 2 * Math.PI * 1.6);
        // the weak hand taps with a smaller, fading amplitude
        const amp = h === this.persona.weakSide ? Math.max(0.35, 0.8 - this.tapPhase * 0.03) : 1;
        this.actors[h].setImmediate(lerpAngles(pinch, open, k * amp));
      }
    } else if (e.kind === 'dial' || e.kind === 'wave' || e.kind === 'spread') {
      this.tapPhase += dt;
      this.posed = true;
      const f = state.station.ready ? state.station.forward : this.facing;
      for (const h of e.hands) {
        const hand = this.actors[h];
        // the weak hand tries along with a smaller movement
        const amp = h === this.persona.weakSide ? this.persona.weakRange[0] : 1;
        const roll0 = h === 'left' ? -4 : 4;
        if (e.kind === 'spread') {
          const k = 0.5 - 0.5 * Math.cos((this.tapPhase * 2 * Math.PI) / 2.2);
          hand.setImmediate(lerpAngles(this.restFor(h), this.reach(h, spreadAngles()), k));
        } else if (e.kind === 'dial') {
          const k = 0.5 - 0.5 * Math.cos((this.tapPhase * 2 * Math.PI) / 3);
          const p = this.restPosition(h);
          p[1] += 0.045;
          hand.setImmediate(this.restFor(h), p, palmDownOrientation(f, roll0 + (h === 'left' ? 1 : -1) * 150 * k * amp));
        } else {
          const k = 0.5 - 0.5 * Math.cos((this.tapPhase * 2 * Math.PI) / 2.4);
          const p = this.restPosition(h);
          p[1] += 0.02;
          const lift = quatAxisAngle(q4(), v3(1, 0, 0), 48 * k * amp * RAD);
          hand.setImmediate(openAngles(), p, quatMul(q4(), palmDownOrientation(f, roll0), lift));
        }
      }
    } else {
      this.tapPhase = 0;
    }
  }
}

function spreadAngles(): HandAngles {
  const a = openAngles();
  a.fingers.forEach((f, i) => (f.mcpAbd = [18, 4, -10, -26][i]));
  return a;
}

function invertRigid(out: Float32Array, m: ArrayLike<number>): void {
  out[0] = m[0];
  out[1] = m[4];
  out[2] = m[8];
  out[3] = 0;
  out[4] = m[1];
  out[5] = m[5];
  out[6] = m[9];
  out[7] = 0;
  out[8] = m[2];
  out[9] = m[6];
  out[10] = m[10];
  out[11] = 0;
  out[12] = -(out[0] * m[12] + out[4] * m[13] + out[8] * m[14]);
  out[13] = -(out[1] * m[12] + out[5] * m[13] + out[9] * m[14]);
  out[14] = -(out[2] * m[12] + out[6] * m[13] + out[10] * m[14]);
  out[15] = 1;
}

export { understudyHand };
