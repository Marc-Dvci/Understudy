/**
 * Functional table exercises: stones to the bowl (pinch, carry and release),
 * turn the dial (forearm rotation), spread and close (finger abduction) and
 * wave (wrist lift). Each runs on "sides": in a mirror session the Lead hand
 * and the rendered Understudy hand, so the mirror performs the task too; with
 * two working hands, both tracked hands. Every exercise keeps each tracked
 * hand's own largest movement, including a hidden Understudy hand.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { Handedness, J } from '../../core/joints.js';
import { v3, Vec3 } from '../../core/math.js';
import { reflectPoint } from '../../core/mirror.js';
import { forearmRoll, pinchDistance, pinchPoint, RepCounter, wristPitch } from '../../core/movement.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { flow } from './engine.js';
import { celebrate } from './playful.js';
import { disposeTransient } from './transient.js';

/** One hand as the exercise sees and draws it. */
export interface Side {
  hand: Handedness;
  /** World-space pose that is drawn for this side. */
  pose(): ArrayLike<number>;
  valid(): boolean;
  /** Extra height of the drawn hand above its pose (the mirror rests on the cloth). */
  lift(): number;
  accent: string;
  /** True when this side copies another (the mirror): it never leads a step. */
  mirrored: boolean;
}

const UP = v3(0, 1, 0);

/** The Lead hand and the mirrored hand on the cloth. */
export function mirrorSides(): Side[] {
  const lead = leadHand();
  return [
    { hand: lead, pose: () => state.hands[lead].pose, valid: () => state.hands[lead].valid, lift: () => 0, accent: PALETTE.lead, mirrored: false },
    {
      hand: understudyHand(),
      pose: () => state.mirror.renderPose,
      valid: () => state.mirror.visibility > 0.5,
      lift: () => stage.mirrorLift,
      accent: PALETTE.understudy,
      mirrored: true,
    },
  ];
}

/** Both tracked hands, for programmes where both hands work. */
export function bothSides(): Side[] {
  return (['left', 'right'] as Handedness[]).map((h) => ({
    hand: h,
    pose: () => state.hands[h].pose,
    valid: () => state.hands[h].valid,
    lift: () => 0,
    accent: h === 'right' ? PALETTE.lead : PALETTE.understudy,
    mirrored: false,
  }));
}

export interface ExerciseResult {
  reps: number;
  /** Each tracked hand's own largest movement in degrees (NaN when not tracked enough). */
  peaks: Record<Handedness, number>;
}

/** Peaks of the tracked hands, which the user moves, not of the drawn mirror. */
class TrackedPeaks {
  private readonly counters: Record<Handedness, RepCounter>;
  private readonly frames = { left: 0, right: 0 };
  constructor(out: number, back: number, circular = false) {
    this.counters = { left: new RepCounter(out, back, circular), right: new RepCounter(out, back, circular) };
  }
  update(measure: (pose: ArrayLike<number>) => number): void {
    for (const h of ['left', 'right'] as Handedness[]) {
      if (!state.hands[h].valid) continue;
      this.frames[h]++;
      this.counters[h].update(measure(state.hands[h].pose));
    }
  }
  result(): Record<Handedness, number> {
    // under half a second of tracking is not a measurement
    const value = (h: Handedness) => (this.frames[h] >= 36 ? this.counters[h].peak : NaN);
    return { left: value('left'), right: value('right') };
  }
}

function material(color: string, emissive = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.55, emissive: new Color(color), emissiveIntensity: emissive });
}

const tmpV = new Vector3();

/** Table-local position under a joint of a pose. */
function underJoint(pose: ArrayLike<number>, joint: number): Vector3 {
  tmpV.set(pose[joint * 16 + 12], pose[joint * 16 + 13], pose[joint * 16 + 14]);
  return stage.table.worldToLocal(tmpV);
}

/** Middle of the palm, table-local. */
function palmLocal(pose: ArrayLike<number>, out: Vector3): Vector3 {
  const a = J.wrist * 16;
  const b = J.middleProx * 16;
  out.set((pose[a + 12] + pose[b + 12]) / 2, (pose[a + 13] + pose[b + 13]) / 2, (pose[a + 14] + pose[b + 14]) / 2);
  return stage.table.worldToLocal(out);
}

function leaders(sides: Side[]): Handedness[] {
  return sides.filter((s) => !s.mirrored).map((s) => s.hand);
}

/** Hands the simulated user moves: the leaders, plus a hidden Understudy hand that tries along. */
function actingHands(sides: Side[]): Handedness[] {
  return sides.some((s) => s.mirrored) ? ['left', 'right'] : leaders(sides);
}

// ------------------------------------------------------------- turn the dial

export async function dialExercise(sides: Side[], turns = 5): Promise<ExerciseResult> {
  flow.step = 'ex-dial';
  const group = new Group();
  group.name = 'exercise-dial';
  stage.table.add(group);
  const cleanup = flow.addCleanup(() => disposeTransient(group));
  const discGeo = new CircleGeometry(0.04, 48);
  const notchGeo = new BoxGeometry(0.007, 0.002, 0.032);
  const dials = sides.map((s) => {
    const g = new Group();
    const disc = new Mesh(discGeo, material('#fbf7f0'));
    disc.rotation.x = -Math.PI / 2;
    const notch = new Mesh(notchGeo, material(s.accent, 0.5));
    notch.position.set(0, 0.002, -0.02);
    g.add(disc, notch);
    const p = palmLocal(s.pose(), new Vector3());
    g.position.set(p.x, 0.002 + s.lift(), p.z);
    group.add(g);
    return { g, counter: new RepCounter(60, 25, true) };
  });
  flow.say('ex-dial', { icon: 'hand', title: 'Turn the dial', body: 'Turn your palm up, then down.' });
  flow.expect = { kind: 'dial', hands: actingHands(sides) };
  const peaks = new TrackedPeaks(60, 25, true);
  let reps = 0;
  const start = flow.time;
  await flow.until(() => {
    sides.forEach((s, i) => {
      if (!s.valid()) return;
      const roll = forearmRoll(s.pose(), UP);
      dials[i].g.rotation.y = (s.hand === 'left' ? 1 : -1) * roll * (Math.PI / 180);
      if (dials[i].counter.update(roll) && !s.mirrored) {
        reps++;
        sound.chime(undefined, true);
        celebrate(dials[i].g.position);
        flow.say(null, { icon: 'hand', title: 'Turn the dial', step: { index: Math.min(reps, turns) - 1, total: turns } });
      }
    });
    peaks.update((pose) => forearmRoll(pose, UP));
    return reps >= turns * Math.max(1, leaders(sides).length) || flow.time - start > 40;
  });
  cleanup();
  discGeo.dispose();
  notchGeo.dispose();
  return { reps, peaks: peaks.result() };
}

// ---------------------------------------------------------------- the wave

export async function waveExercise(sides: Side[], waves = 6): Promise<ExerciseResult> {
  flow.step = 'ex-wave';
  const group = new Group();
  group.name = 'exercise-wave';
  stage.table.add(group);
  const cleanup = flow.addCleanup(() => disposeTransient(group));
  const orbGeo = new SphereGeometry(0.014, 20, 14);
  const orbs = sides.map((s) => {
    const m = new Mesh(orbGeo, material(s.accent, 0.1));
    const tip = underJoint(s.pose(), J.middleTip).clone();
    m.position.set(tip.x, 0.09 + s.lift(), tip.z);
    group.add(m);
    return { m, counter: new RepCounter(22, 8) };
  });
  flow.say('ex-wave', { icon: 'hand', title: 'Wave', body: 'Lift your hand at the wrist, then lower it.' });
  flow.expect = { kind: 'wave', hands: actingHands(sides) };
  const peaks = new TrackedPeaks(22, 8);
  let reps = 0;
  const start = flow.time;
  await flow.until(() => {
    sides.forEach((s, i) => {
      if (!s.valid()) return;
      const pitch = wristPitch(s.pose(), UP);
      const o = orbs[i];
      (o.m.material as MeshStandardMaterial).emissiveIntensity = 0.1 + 1.4 * o.counter.level(pitch);
      if (o.counter.update(pitch) && !s.mirrored) {
        reps++;
        sound.chime(undefined, true);
        celebrate(o.m.position);
        flow.say(null, { icon: 'hand', title: 'Wave', step: { index: Math.min(reps, waves) - 1, total: waves } });
      }
    });
    peaks.update((pose) => wristPitch(pose, UP));
    return reps >= waves * Math.max(1, leaders(sides).length) || flow.time - start > 40;
  });
  cleanup();
  return { reps, peaks: peaks.result() };
}

// -------------------------------------------------------- spread and close

export async function spreadExercise(sides: Side[], reps = 6): Promise<ExerciseResult> {
  flow.step = 'ex-spread';
  const group = new Group();
  group.name = 'exercise-spread';
  stage.table.add(group);
  const cleanup = flow.addCleanup(() => disposeTransient(group));
  const slatGeo = new BoxGeometry(0.009, 0.002, 0.055);
  slatGeo.translate(0, 0, -0.0275);
  const fans = sides.map((s) => {
    const g = new Group();
    const slats: Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new Mesh(slatGeo, material(i === 2 ? s.accent : '#fbf7f0', i === 2 ? 0.4 : 0));
      g.add(m);
      slats.push(m);
    }
    // beyond the fingertips, where the hand does not hide it
    const p = underJoint(s.pose(), J.middleTip).clone();
    g.position.set(p.x, 0.002 + s.lift(), p.z - 0.05);
    group.add(g);
    return { g, slats, counter: new RepCounter(12, 5), rest: NaN };
  });
  flow.say('ex-spread', { icon: 'open', title: 'Spread and close', body: 'Spread your fingers wide, then bring them together.' });
  flow.expect = { kind: 'spread', hands: actingHands(sides) };
  let count = 0;
  const start = flow.time;
  await flow.until(() => {
    sides.forEach((s, i) => {
      if (!s.valid()) return;
      const spread = s.mirrored ? mirrorSpread() : state.hands[s.hand].kin.spread;
      const f = fans[i];
      if (!Number.isFinite(f.rest)) f.rest = spread;
      const open = Math.max(0, spread - f.rest + 8) * (Math.PI / 180);
      f.slats.forEach((m, k) => (m.rotation.y = (k - 2) * open * 0.8));
      if (f.counter.update(spread) && !s.mirrored) {
        count++;
        sound.chime(undefined, true);
        celebrate(f.g.position);
        flow.say(null, { icon: 'open', title: 'Spread and close', step: { index: Math.min(count, reps) - 1, total: reps } });
      }
    });
    for (const h of ['left', 'right'] as Handedness[]) if (state.hands[h].valid) spreadPeak.feed(h, state.hands[h].kin.spread);
    return count >= reps * Math.max(1, leaders(sides).length) || flow.time - start > 40;
  });
  cleanup();
  slatGeo.dispose();
  return { reps: count, peaks: spreadPeak.take() };
}

/** Finger spread of the rendered mirror hand: index to little proximal phalanges. */
function mirrorSpread(): number {
  const p = state.mirror.renderPose;
  const a = J.indexProx * 16;
  const b = J.pinkyProx * 16;
  const ax = -p[a + 8], ay = -p[a + 9], az = -p[a + 10];
  const bx = -p[b + 8], by = -p[b + 9], bz = -p[b + 10];
  const c = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz) || 1);
  return Math.acos(Math.max(-1, Math.min(1, c))) * (180 / Math.PI);
}

/** Largest spread above the hand's own starting spread, per tracked hand. */
const spreadPeak = {
  start: { left: NaN, right: NaN } as Record<Handedness, number>,
  peak: { left: 0, right: 0 } as Record<Handedness, number>,
  frames: { left: 0, right: 0 } as Record<Handedness, number>,
  feed(h: Handedness, v: number): void {
    if (!Number.isFinite(v)) return;
    if (!Number.isFinite(this.start[h])) this.start[h] = v;
    this.frames[h]++;
    this.peak[h] = Math.max(this.peak[h], v - this.start[h]);
  },
  take(): Record<Handedness, number> {
    const out = {
      left: this.frames.left >= 36 ? this.peak.left : NaN,
      right: this.frames.right >= 36 ? this.peak.right : NaN,
    };
    this.start = { left: NaN, right: NaN };
    this.peak = { left: 0, right: 0 };
    this.frames = { left: 0, right: 0 };
    return out;
  },
};

// ------------------------------------------------------ stones to the bowl

const GRAB = 0.026;
const RELEASE = 0.045;

interface Pebble {
  mesh: Mesh;
  held: boolean;
  placed: boolean;
}

/**
 * Pinch a stone, carry it and open over the bowl. The Lead side's stones sit
 * beside its hand; the mirror side's are their reflection, so the mirrored
 * hand reaches its own stones while the Lead moves.
 */
export async function stonesExercise(sides: Side[], count = 3): Promise<ExerciseResult> {
  flow.step = 'ex-stones';
  const group = new Group();
  group.name = 'exercise-stones';
  stage.table.add(group);
  const cleanup = flow.addCleanup(() => disposeTransient(group));
  const pebbleGeo = new SphereGeometry(0.012, 18, 12);
  pebbleGeo.scale(1, 0.62, 1);
  const bowlGeo = new TorusGeometry(0.042, 0.007, 10, 36);
  const baseGeo = new CylinderGeometry(0.042, 0.036, 0.004, 36);
  const colors = ['#9aa7b4', '#b49a86', '#8fae9b'];
  const lead = sides.find((s) => !s.mirrored) ?? sides[0];

  // stones and a bowl on the outer and inner side of each leading hand
  const layout = (s: Side) => {
    const o = s.hand === 'right' ? 1 : -1;
    return {
      stones: [0, 1, 2].slice(0, count).map((i) => new Vector3(o * 0.25, 0.008, -(-0.06 + i * 0.055))),
      bowl: new Vector3(o * 0.07, 0.002, -0.075),
    };
  };
  type Station = { side: Side; pebbles: Pebble[]; bowl: Vector3; holding: Pebble | null; placed: number };
  const stations: Station[] = [];
  const mirrorOf = (p: Vector3) => {
    const w = stage.table.localToWorld(p.clone());
    const r = reflectPoint(v3(), v3(w.x, w.y, w.z), state.mirror.plane);
    return stage.table.worldToLocal(new Vector3(r[0], r[1], r[2]));
  };
  for (const s of sides) {
    const base = s.mirrored ? layout(lead) : layout(s);
    const place = (p: Vector3) => (s.mirrored ? mirrorOf(p) : p.clone());
    const bowl = place(base.bowl);
    bowl.y = 0.002;
    const rim = new Mesh(bowlGeo, material('#e9e2d6'));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(bowl.x, 0.008, bowl.z);
    const floor = new Mesh(baseGeo, material(s.accent, 0.15));
    floor.position.set(bowl.x, 0.003, bowl.z);
    group.add(rim, floor);
    const pebbles = base.stones.map((p, i) => {
      const m = new Mesh(pebbleGeo, material(colors[i % colors.length]));
      const q = place(p);
      m.position.set(q.x, 0.008, q.z);
      group.add(m);
      return { mesh: m, held: false, placed: false };
    });
    stations.push({ side: s, pebbles, bowl, holding: null, placed: 0 });
  }

  flow.say('ex-stones', { icon: 'touch', title: 'Stones to the bowl', body: 'Pinch a stone, carry it, open over the bowl.' });
  const pinch = v3();
  const local = new Vector3();
  const leading = stations.filter((s) => !s.side.mirrored);
  let total = 0;
  for (const st of leading) {
    for (let i = 0; i < st.pebbles.length; i++) {
      const target = st.pebbles[i];
      if (target.placed) continue;
      const from = stage.table.localToWorld(target.mesh.position.clone());
      const to = stage.table.localToWorld(st.bowl.clone().setY(0.012));
      flow.expect = { kind: 'pinch-place', hand: st.side.hand, from: [from.x, from.y, from.z], to: [to.x, to.y, to.z] };
      flow.say(null, { icon: 'touch', title: 'Stones to the bowl', step: { index: total, total: leading.length * count } });
      await flow.until(() => {
        for (const s of stations) stepStation(s, pinch, local);
        return target.placed;
      }, 14);
      total++;
    }
  }
  flow.expect = { kind: 'idle' };
  await flow.wait(0.4);
  cleanup();
  pebbleGeo.dispose();
  const placed = leading.reduce((n, s) => n + s.placed, 0);
  return { reps: placed, peaks: { left: NaN, right: NaN } };

  function stepStation(s: Station, p: Vec3, l: Vector3): void {
    if (!s.side.valid()) return;
    const pose = s.side.pose();
    const d = pinchDistance(pose);
    pinchPoint(pose, p);
    l.set(p[0], p[1] + s.side.lift(), p[2]);
    stage.table.worldToLocal(l);
    if (!s.holding && d < GRAB) {
      // the nearest free stone within reach of the pinch
      let best: Pebble | null = null;
      let bestD = s.side.mirrored ? 0.06 : 0.045;
      for (const pb of s.pebbles) {
        if (pb.placed) continue;
        const dd = Math.hypot(pb.mesh.position.x - l.x, pb.mesh.position.z - l.z, Math.max(0, l.y - pb.mesh.position.y - 0.03));
        if (dd < bestD) { bestD = dd; best = pb; }
      }
      if (best) { best.held = true; s.holding = best; sound.press(); }
    }
    if (s.holding) {
      const h = s.holding;
      h.mesh.position.set(l.x, Math.max(0.008, l.y - 0.004), l.z);
      if (d > RELEASE) {
        h.held = false;
        s.holding = null;
        const inBowl = Math.hypot(l.x - s.bowl.x, l.z - s.bowl.z) < 0.05;
        if (inBowl) {
          h.placed = true;
          s.placed++;
          h.mesh.position.set(s.bowl.x + (s.placed - 2) * 0.012, 0.01, s.bowl.z + ((s.placed % 2) - 0.5) * 0.01);
          const world = stage.table.localToWorld(h.mesh.position.clone());
          sound.note(s.placed, [world.x, world.y, world.z]);
          celebrate(h.mesh.position);
        } else {
          h.mesh.position.y = 0.008;
        }
      }
    }
  }
}
