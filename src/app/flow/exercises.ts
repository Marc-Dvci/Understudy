/**
 * Table exercises. Every exercise is bimanual and symmetric so the mirror can
 * perform it on the Understudy side, and every one records a measurement.
 */
import {
  BoxGeometry,
  CircleGeometry,
  Vector3,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  ShapeGeometry,
  Shape,
  SphereGeometry,
} from '@iwsdk/core';
import { Handedness, J } from '../../core/joints.js';
import { computeKinematics, newKinematics } from '../../core/kinematics.js';
import { individuation, MIN_VALID_FRAMES, MIN_VALID_SHARE, TapResult } from '../../core/measure.js';
import { mean } from '../../core/math.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { captureTapping } from './capture.js';
import { flow } from './engine.js';
import { celebrate } from './playful.js';
import { disposeTransient } from './transient.js';

const mirrorKin = newKinematics('left');

/** Kinematics of the rendered Understudy hand (what the user sees). */
function renderedKin() {
  mirrorKin.handedness = understudyHand();
  return computeKinematics(state.mirror.renderPose, understudyHand(), mirrorKin);
}

// ------------------------------------------------------------------ flower

function petalShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.012, 0.012, 0.014, 0.034, 0, 0.05);
  s.bezierCurveTo(-0.014, 0.034, -0.012, 0.012, 0, 0);
  return s;
}

class Flower {
  readonly group = new Group();
  private readonly petals: Mesh[] = [];
  open = 0;
  constructor(color: string) {
    const geo = new ShapeGeometry(petalShape(), 10);
    const mat = new MeshStandardMaterial({ color: new Color(color), roughness: 0.6, side: 2 });
    for (let i = 0; i < 7; i++) {
      const pivot = new Group();
      pivot.rotation.y = (i / 7) * Math.PI * 2;
      const m = new Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      pivot.add(m);
      this.group.add(pivot);
      this.petals.push(m);
    }
    const heart = new Mesh(new SphereGeometry(0.009, 16, 12), new MeshStandardMaterial({ color: new Color('#f6c945'), roughness: 0.5 }));
    heart.position.y = 0.006;
    this.group.add(heart);
    this.group.visible = false;
  }
  update(): void {
    for (const p of this.petals) p.rotation.x = -Math.PI / 2 + (1 - this.open) * 1.25;
    this.group.scale.setScalar(1.5 + 0.6 * this.open);
  }
}

export async function flowerExercise(reps = 6): Promise<{ reps: number; peakOpening: Record<Handedness, number> }> {
  flow.step = 'ex-flower';
  const lead = leadHand();
  const flowers: Record<string, Flower> = { lead: new Flower('#f19bb5'), us: new Flower('#9bc4f1') };
  stage.table.add(flowers.lead.group, flowers.us.group);
  const cleanup = flow.addCleanup(() => disposeTransient(flowers.lead.group, flowers.us.group));
  // each flower blooms just beyond its hand's middle fingertip
  const place = (f: Flower, pose: Float32Array, lift: number) => {
    const tip = new Vector3(pose[J.middleTip * 16 + 12], pose[J.middleTip * 16 + 13] - lift, pose[J.middleTip * 16 + 14]);
    stage.table.worldToLocal(tip);
    f.group.position.set(tip.x, 0.003, tip.z - 0.07);
    f.group.visible = true;
  };
  flowers.lead.group.scale.setScalar(1.8);
  flowers.us.group.scale.setScalar(1.8);
  place(flowers.lead, state.hands[lead].pose, 0);
  place(flowers.us, state.mirror.renderPose, 0);
  flow.say('ex-flower', { icon: 'open', title: 'Open the flower', body: 'Open both hands, then close them.' });
  flow.expect = { kind: 'mirror-play', style: 'open-close' };
  let count = 0;
  let wasOpen = false;
  const peak = { left: 0, right: 0 };
  const start = flow.time;
  await flow.until(() => {
    const lk = state.hands[lead].kin;
    const rk = renderedKin();
    // scaled to the lead hand's own range from today's Hand Print
    const range = state.openingRange[lead];
    const span = Math.max(0.05, range.open - range.closed);
    const lo = Math.min(1, Math.max(0, (lk.opening - range.closed) / span));
    const uo = Math.min(1, Math.max(0, (rk.opening - range.closed) / span));
    flowers.lead.open += (lo - flowers.lead.open) * 0.2;
    flowers.us.open += (uo - flowers.us.open) * 0.2;
    flowers.lead.update();
    flowers.us.update();
    const us = state.hands[understudyHand()];
    if (us.valid) peak[understudyHand()] = Math.max(peak[understudyHand()], us.kin.opening * 100);
    peak[lead] = Math.max(peak[lead], lk.opening * 100);
    if (lo > 0.8 && !wasOpen) {
      wasOpen = true;
      count++;
      sound.chime(undefined, true);
      celebrate(flowers.lead.group.position);
      flow.say(null, { icon: 'open', title: 'Open the flower', step: { index: Math.min(count, reps) - 1, total: reps } });
    } else if (lo < 0.25) wasOpen = false;
    return count >= reps || flow.time - start > 40;
  });
  cleanup();
  return { reps: count, peakOpening: peak };
}

// ------------------------------------------------------------------ piano

export async function pianoExercise(notes = 8): Promise<{ played: number; individuation: Record<Handedness, number>; validShare: Record<Handedness, number> }> {
  flow.step = 'ex-piano';
  const lead = leadHand();
  const keyGeo = new BoxGeometry(0.02, 0.006, 0.055);
  const keys: { lead: Mesh[]; us: Mesh[] } = { lead: [], us: [] };
  const group = new Group();
  stage.table.add(group);
  group.name = 'exercise-piano';
  const cleanup = flow.addCleanup(() => { disposeTransient(group); keyGeo.dispose(); });
  const tipJ = [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip];
  const keyAt = (pose: Float32Array, f: number) => {
    const v = new Vector3(pose[tipJ[f] * 16 + 12], 0, pose[tipJ[f] * 16 + 14]);
    stage.table.worldToLocal(v);
    return v;
  };
  flow.say('ex-piano', { icon: 'hand', title: 'Table piano', body: 'Press the key that lights up.' });
  // resting baseline: half a second of both hands still on the table
  flow.expect = { kind: 'rest' };
  await flow.wait(1.4);
  const baseLead = [0, 0, 0, 0];
  const baseUs = [0, 0, 0, 0];
  let nLead = 0, nUs = 0, frames = 0;
  let validLead = 0, validUs = 0;
  const end0 = flow.time + 0.5;
  await flow.until(() => {
    const lk = state.hands[lead].kin;
    const uk = state.hands[understudyHand()].kin;
    const leadValid = state.hands[lead].valid, usValid = state.hands[understudyHand()].valid;
    for (let i = 0; i < 4; i++) {
      if (leadValid) baseLead[i] += lk.fingers[i].sum;
      if (usValid) baseUs[i] += uk.fingers[i].sum;
    }
    frames++;
    if (leadValid) { nLead++; validLead++; }
    if (usValid) { nUs++; validUs++; }
    return flow.time >= end0;
  });
  for (let i = 0; i < 4; i++) {
    baseLead[i] = nLead >= MIN_VALID_FRAMES ? baseLead[i] / nLead : NaN;
    baseUs[i] = nUs >= MIN_VALID_FRAMES ? baseUs[i] / nUs : NaN;
  }
  // one key under each resting fingertip, on both sides
  for (const side of ['lead', 'us'] as const) {
    const pose = side === 'lead' ? state.hands[lead].pose : state.mirror.renderPose;
    for (let f = 0; f < 4; f++) {
      const m = new Mesh(keyGeo, new MeshStandardMaterial({ color: new Color('#fbf7f0'), roughness: 0.5, emissive: new Color(side === 'lead' ? PALETTE.lead : PALETTE.understudy), emissiveIntensity: 0 }));
      const p = keyAt(pose, f);
      m.position.set(p.x, 0.003, p.z - 0.01);
      group.add(m);
      keys[side].push(m);
    }
  }
  const indLead: number[] = [];
  const indUs: number[] = [];
  let played = 0;
  for (let n = 0; n < notes; n++) {
    const finger = [0, 1, 2, 3, 3, 2, 1, 0][n % 8];
    flow.expect = { kind: 'piano', finger };
    for (const side of ['lead', 'us'] as const) keys[side].forEach((k, i) => ((k.material as MeshStandardMaterial).emissiveIntensity = i === finger ? 1.6 : 0.12));
    const peakLead = [...baseLead];
    const peakUs = [...baseUs];
    const ok = await flow.until(() => {
      const lk = state.hands[lead].kin;
      const leadValid = state.hands[lead].valid;
      frames++;
      if (leadValid) { validLead++; for (let i = 0; i < 4; i++) peakLead[i] = Math.max(peakLead[i], lk.fingers[i].sum); }
      const us = state.hands[understudyHand()];
      if (us.valid) { validUs++; for (let i = 0; i < 4; i++) peakUs[i] = Math.max(peakUs[i], us.kin.fingers[i].sum); }
      return leadValid && lk.fingers[finger].sum - baseLead[finger] > 28;
    }, 8);
    if (ok) {
      played++;
      sound.note(finger + 1, state.hands[lead].indexTip);
      const tip = stage.mirrorTip(new Float64Array(3));
      sound.note(finger + 1, tip);
      keys.lead[finger].position.y = 0.001;
      keys.us[finger].position.y = 0.001;
      const il = individuation(finger, baseLead, peakLead);
      const iu = individuation(finger, baseUs, peakUs);
      if (Number.isFinite(il) && state.hands[lead].valid) indLead.push(il);
      if (Number.isFinite(iu) && state.hands[understudyHand()].valid) indUs.push(iu);
    }
    await flow.until(() => state.hands[lead].kin.fingers[finger].sum - baseLead[finger] < 14, 3);
    keys.lead[finger].position.y = 0.003;
    keys.us[finger].position.y = 0.003;
  }
  cleanup();
  return {
    played,
    individuation: { [lead]: validLead / frames >= MIN_VALID_SHARE ? mean(indLead) : NaN, [understudyHand()]: validUs / frames >= MIN_VALID_SHARE ? mean(indUs) : NaN } as Record<Handedness, number>,
    validShare: { [lead]: validLead / frames, [understudyHand()]: validUs / frames } as Record<Handedness, number>,
  };
}

// ------------------------------------------------------------ thumb touches

export async function thumbExercise(rounds = 1): Promise<{ touches: number }> {
  flow.step = 'ex-thumb';
  const lead = leadHand();
  const light = new Mesh(new SphereGeometry(0.009, 16, 12), new MeshStandardMaterial({ color: new Color('#ffffff'), emissive: new Color(PALETTE.lead), emissiveIntensity: 1.2 }));
  const lightUs = new Mesh(light.geometry, new MeshStandardMaterial({ color: new Color('#ffffff'), emissive: new Color(PALETTE.understudy), emissiveIntensity: 1.2 }));
  stage.root.add(light, lightUs);
  const cleanup = flow.addCleanup(() => disposeTransient(light, lightUs));
  flow.say('ex-thumb', { icon: 'thumb', title: 'Thumb touches', body: 'Thumb to each fingertip in turn.' });
  const tips = [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip];
  let touches = 0;
  for (let r = 0; r < rounds; r++) {
    for (let f = 0; f < 4; f++) {
      flow.expect = { kind: 'thumb-touch', finger: f };
      const ok = await flow.until(() => {
        if (!state.hands[lead].valid) return false;
        const p = state.hands[lead].pose;
        light.position.set(p[tips[f] * 16 + 12], p[tips[f] * 16 + 13] + 0.012, p[tips[f] * 16 + 14]);
        const q = state.mirror.renderPose;
        lightUs.position.set(q[tips[f] * 16 + 12], q[tips[f] * 16 + 13] + 0.012 + stage.mirrorLift, q[tips[f] * 16 + 14]);
        const dx = p[tips[f] * 16 + 12] - p[J.thumbTip * 16 + 12];
        const dy = p[tips[f] * 16 + 13] - p[J.thumbTip * 16 + 13];
        const dz = p[tips[f] * 16 + 14] - p[J.thumbTip * 16 + 14];
        return Math.hypot(dx, dy, dz) < 0.022;
      }, 8);
      if (ok) {
        touches++;
        sound.note(f, light.position.toArray());
        sound.note(f, lightUs.position.toArray());
      }
      await flow.wait(0.35);
    }
  }
  cleanup();
  return { touches };
}

// -------------------------------------------------------------- tap rhythm

export async function tapExercise(seconds = 10): Promise<Record<Handedness, TapResult>> {
  flow.step = 'ex-tap';
  flow.say('ex-tap', { icon: 'touch', title: 'Tap rhythm', body: 'Thumb and index, with the beat.' });
  flow.expect = { kind: 'tap-rhythm' };
  await flow.wait(2.5);
  let next = flow.time;
  const beat = 1 / 1.6;
  const dot = new Mesh(new CircleGeometry(0.02, 32), new MeshStandardMaterial({ color: new Color(PALETTE.lead), emissive: new Color(PALETTE.lead), emissiveIntensity: 0.2 }));
  dot.rotation.x = -Math.PI / 2;
  dot.position.set(0, 0.002, -0.14);
  stage.table.add(dot);
  const cleanup = flow.addCleanup(() => disposeTransient(dot));
  let result: Record<Handedness, TapResult> | undefined;
  const run = captureTapping(['left', 'right'], seconds).then((value) => { result = value; });
  // The awaited flow below owns interruption; handle the sibling capture too.
  void run.catch(() => undefined);
  const end = flow.time + seconds;
  await flow.until(() => {
    if (flow.time >= next) {
      next += beat;
      sound.tick();
      (dot.material as MeshStandardMaterial).emissiveIntensity = 1;
    }
    const m = dot.material as MeshStandardMaterial;
    m.emissiveIntensity *= 0.9;
    return flow.time >= end;
  }, seconds + 1);
  await run;
  cleanup();
  return result!;
}
