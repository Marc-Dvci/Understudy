/**
 * Reusable steps: finding the table, choosing the side, the Hand Print, the
 * cloth and mirror, the drift check, pain check-in.
 */
import { computeDrift, driftSentence, DriftResult, Point2 } from '../../core/embodiment.js';
import { Handedness, J, otherHand } from '../../core/joints.js';
import { METRICS, MetricId, HandPrint } from '../../core/measure.js';
import { clamp, v3 } from '../../core/math.js';
import { metricKey, SessionRecord } from '../../core/records.js';
import { estimateError } from '../../core/stats.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { drawDrift, drawHandPrint, PrintView } from '../ui/viz.js';
import { captureTrial, combineTrial, sessionPrint } from './capture.js';
import { flow } from './engine.js';
import { services } from './services.js';

export async function findTable(): Promise<void> {
  flow.step = 'find-table';
  stage.cardSlot = 'high';
  services.station?.search();
  flow.expect = { kind: 'rest' };
  // before the station exists the card floats ahead at chest height
  placeFloatingCard();
  flow.say('welcome', { icon: 'hand', title: 'Rest both hands on the table', body: 'Palms down, fingers relaxed.' });
  let hinted = false;
  await flow.until(() => {
    placeFloatingCard();
    if (!hinted && (services.station?.searchTime ?? 0) > 8) {
      hinted = true;
      flow.say('station-hint', { icon: 'hand', title: 'Hands flat and still', body: 'Put both hands flat on the table for a moment.' });
    }
    return state.station.ready;
  });
  stage.cardSlot = 'back';
  stage.card.group.parent !== stage.table && stage.table.add(stage.card.group);
  stage.mat.show(state.station.source === 'lap');
  stage.mat.pulseRests();
  sound.chime();
  await flow.tell('station-found', { icon: 'check', title: 'Your table is ready', accent: PALETTE.good }, 1.6);
}

function placeFloatingCard(): void {
  if (state.station.ready) return;
  const g = stage.card.group;
  if (g.parent !== stage.root) stage.root.add(g);
  const f = state.headForward;
  // ahead and below eye level, where the table will be
  g.position.set(state.head[0] + f[0] * 0.62, state.head[1] - 0.34, state.head[2] + f[2] * 0.62);
  g.rotation.set(-0.5, Math.atan2(-f[0], -f[2]), 0, 'YXZ');
}

export async function chooseSide(expect: Handedness | 'both' = 'left'): Promise<Handedness | 'both'> {
  flow.step = 'choose-side';
  stage.stone({ id: 'side-left', label: 'Left hand', icon: 'left', accent: PALETTE.understudy });
  stage.stone({ id: 'side-both', label: 'Both hands', icon: 'both', accent: PALETTE.understudy });
  stage.stone({ id: 'side-right', label: 'Right hand', icon: 'right', accent: PALETTE.understudy });
  flow.say('which-hand', { icon: 'touch', title: 'Which hand needs help?', body: 'Touch a stone. Press right down onto the table.' });
  const id = await flow.choose(['side-left', 'side-both', 'side-right'], `side-${expect}`);
  const side = id === 'side-left' ? 'left' : id === 'side-right' ? 'right' : 'both';
  state.profile.understudy = side === 'both' ? null : side;
  if (side !== 'both') await stage.setUnderstudySide(services.base);
  return side;
}

const MOVES: { id: 'open' | 'fist' | 'oppose'; title: string; icon: 'open' | 'fist' | 'thumb' }[] = [
  { id: 'open', title: 'Open both hands wide', icon: 'open' },
  { id: 'fist', title: 'Make a fist', icon: 'fist' },
  { id: 'oppose', title: 'Thumb to little finger', icon: 'thumb' },
];

export interface PrintResult {
  hands: Handedness[];
  trials: Record<Handedness, HandPrint[]>;
  /** Pose at the fullest fist per hand. */
  peak: Record<Handedness, { sum: number; pose: Float32Array | null }>;
}

/** Three trials of open, fist and opposition for the given hands. */
export async function handPrint(hands: Handedness[], trialsCount = 3): Promise<PrintResult> {
  flow.step = 'hand-print';
  await flow.tell('handprint-intro', { icon: 'hand', title: 'Your hand print', body: 'Three quick movements, three times.' }, 3.2);
  const trials: Record<Handedness, HandPrint[]> = { left: [], right: [] };
  const peak = { left: { sum: -Infinity, pose: null as Float32Array | null }, right: { sum: -Infinity, pose: null as Float32Array | null } };
  for (let t = 0; t < trialsCount; t++) {
    const buffers: Partial<Record<(typeof MOVES)[number]['id'], Awaited<ReturnType<typeof captureTrial>>>> = {};
    for (let m = 0; m < MOVES.length; m++) {
      const mv = MOVES[m];
      flow.expect = { kind: 'move', movement: mv.id, hands };
      flow.say(t === 0 ? mv.id : null, { icon: mv.icon, title: mv.title, step: { index: t * 3 + m, total: trialsCount * 3 } });
      buffers[mv.id] = await captureTrial(hands, 1.7, t === 0 ? 1.1 : 0.7, mv.id === 'fist' ? peak : undefined);
      sound.tap(undefined, 0.3);
    }
    for (const h of hands) {
      trials[h].push(combineTrial(buffers.fist![h], buffers.open![h], buffers.oppose![h]));
      const op = buffers.open![h].opening;
      const cl = buffers.fist![h].opening;
      if (op.length > 10 && cl.length > 10) {
        state.openingRange[h] = { open: Math.max(...op) / 100, closed: Math.min(...cl) / 100 };
      }
    }
  }
  flow.expect = { kind: 'move', movement: 'relax', hands };
  sound.chime();
  return { hands, trials, peak };
}

export function printViews(result: PrintResult, records: SessionRecord[]): PrintView[] {
  const fingers: MetricId[] = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'];
  return result.hands.map((h) => {
    const s = sessionPrint(result.trials[h]);
    const role = state.profile.understudy === null ? 'both' : h === understudyHand() ? 'understudy' : 'lead';
    const mdc = fingers.map((id) => {
      const key = metricKey(h, id);
      const series = records.map((r) => r.metrics[key]?.value ?? NaN);
      const tr = records.map((r) => r.metrics[key]?.trials ?? []);
      return estimateError(tr, series, METRICS[id].priorSem).mdc;
    });
    return { hand: h, role, tam: s.tam, tamTotal: s.tamTotal, opening: s.opening, kapandji: s.kapandji, mdc };
  });
}

export async function showHandPrint(result: PrintResult, records: SessionRecord[]): Promise<void> {
  stage.card.hide();
  const order = result.hands.slice().sort((a) => (a === 'left' ? -1 : 1));
  const views = printViews({ ...result, hands: order }, records);
  stage.board.draw(drawHandPrint(views, 'Hand print'), 1.6);
  stage.board.show();
  void sound.say('handprint-done');
  await flow.wait(6);
}

export function recordPrint(record: SessionRecord, result: PrintResult): void {
  record.poses = record.poses ?? {};
  for (const h of result.hands) {
    const p = result.peak?.[h]?.pose;
    if (p) record.poses[h] = { fist: Array.from(p, (x) => Math.round(x * 1e4) / 1e4) };
    const trials = result.trials[h];
    const s = sessionPrint(trials);
    const put = (id: MetricId, value: number, perTrial: number[]) => {
      record.metrics[metricKey(h, id)] = { value, trials: perTrial, validShare: s.validShare };
    };
    (['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as MetricId[]).forEach((id, f) =>
      put(id, s.tam[f], trials.map((t) => t.tam[f])),
    );
    put('tam.total', s.tamTotal, trials.map((t) => t.tamTotal));
    put('opening', s.opening, trials.map((t) => t.opening));
    put('spread', s.spread, trials.map((t) => t.spread));
    put('kapandji', s.kapandji, trials.map((t) => t.kapandji));
  }
}

/** Covers the Understudy hand with the cloth and starts the mirror in Watch. */
export async function startMirror(): Promise<boolean> {
  flow.step = 'cloth';
  const us = state.hands[understudyHand()];
  flow.expect = { kind: 'rest' };
  flow.say('cloth-intro', { icon: 'cloth', title: 'Keep your hand still', body: `A cloth will cover your ${understudyHand()} hand.` });
  await flow.until(() => us.valid && state.hands[leadHand()].valid, 8);
  await flow.wait(1.2);
  if (!services.mirror?.calibrateFromHands()) return false;
  const rest = state.mirror.restPose;
  const cx = (rest[J.wrist * 16 + 12] + rest[J.middleTip * 16 + 12]) / 2;
  const cz = (rest[J.wrist * 16 + 14] + rest[J.middleTip * 16 + 14]) / 2;
  const fx = rest[J.middleTip * 16 + 12] - rest[J.wrist * 16 + 12];
  const fz = rest[J.middleTip * 16 + 14] - rest[J.wrist * 16 + 14];
  stage.cloth.place(cx, state.station.height, cz, fx, fz);
  stage.cloth.show();
  state.mirror.cloth = true;
  stage.mirrorLift = stage.cloth.bulge * 0.62;
  stage.mat.showRests = false;
  stage.mat.showMidline = true;
  stage.mat.markDirty();
  await flow.until(() => stage.cloth.settled, 2);
  sound.tap(undefined, 0.2);
  state.mirror.offset = 0;
  state.mirror.active = true;
  if (services.mirror) services.mirror.forceWatch = true;
  return true;
}

export function stopMirror(): void {
  state.mirror.active = false;
  state.mirror.cloth = false;
  stage.cloth.hide();
  stage.mirrorLift = 0;
  stage.mat.showRests = true;
  stage.mat.showMidline = false;
  stage.mat.markDirty();
}

/** A short guided mirror play: open-close, taps, finger wiggles. */
export async function mirrorPlay(seconds = 22): Promise<void> {
  flow.step = 'mirror-play';
  const tips = [v3(), v3()];
  let lastTouch = { lead: false };
  const tapWatch = () => {
    const lead = state.hands[leadHand()];
    if (!lead.valid) return;
    const touching = lead.indexTip[1] - 0.009 < state.station.height + 0.006;
    if (touching && !lastTouch.lead) {
      sound.tap(lead.indexTip, 0.6);
      stage.mirrorTip(tips[1]);
      sound.tap(tips[1], 0.6);
    }
    lastTouch.lead = touching;
  };
  const segment = async (id: 'mirror-move' | 'mirror-tap' | 'mirror-wiggle', style: 'open-close' | 'tap' | 'wiggle', title: string, s: number) => {
    flow.expect = { kind: 'mirror-play', style };
    flow.say(id, { icon: 'mirror', title, accent: PALETTE.understudy });
    const end = flow.time + s;
    await flow.until(() => {
      tapWatch();
      return flow.time >= end;
    });
  };
  await segment('mirror-move', 'open-close', 'Open and close slowly', seconds * 0.45);
  await segment('mirror-tap', 'tap', 'Tap the table', seconds * 0.3);
  await segment('mirror-wiggle', 'wiggle', 'Wiggle one finger at a time', seconds * 0.25);
}

/** Proprioceptive drift: touches before and after mirroring at an offset. */
export async function embodimentCheck(): Promise<DriftResult> {
  flow.step = 'drift';
  const offset = 0.12;
  await flow.tell('drift-intro', { icon: 'eye', title: 'How does it feel?', body: 'A quick check of the mirror.' }, 2.4);
  const truth3 = services.mirror!.hiddenIndexTip(v3());
  const truth: Point2 = { x: truth3[0], z: truth3[2] };
  const collect = async (phase: 'pre' | 'post'): Promise<Point2[]> => {
    state.mirror.active = false;
    const touches: Point2[] = [];
    for (let i = 0; i < 3; i++) {
      flow.expect = { kind: 'touch', target: 'hidden-index', phase };
      flow.say(i === 0 ? 'drift-touch' : null, {
        icon: 'touch',
        title: 'Touch above your hidden index',
        body: 'Use your other hand. Touch the table.',
        step: { index: i, total: 3 },
      });
      const lead = state.hands[leadHand()];
      // a touch is the Lead index fingertip reaching the table on the Understudy side
      let armed = false;
      await flow.until(() => {
        if (!lead.valid) return false;
        const h = lead.indexTip[1] - 0.009 - state.station.height;
        if (h > 0.03) armed = true;
        const side = (lead.indexTip[0] - state.mirror.plane.origin[0]) * state.mirror.plane.normal[0] +
          (lead.indexTip[2] - state.mirror.plane.origin[2]) * state.mirror.plane.normal[2];
        if (armed && h < 0.006 && side > 0.02) {
          touches.push({ x: lead.indexTip[0], z: lead.indexTip[2] });
          return true;
        }
        return false;
      }, 25);
      sound.tap(lead.indexTip, 0.5);
      await flow.wait(0.6);
    }
    return touches;
  };
  const pre = await collect('pre');
  // mirror with the virtual hand displaced toward the Lead-far side
  state.mirror.offset = offset;
  state.mirror.active = true;
  flow.say('drift-watch', { icon: 'mirror', title: 'Move with the hand you see', body: 'Open, close and tap, slowly.' });
  flow.expect = { kind: 'mirror-play', style: 'open-close' };
  await flow.wait(14);
  flow.expect = { kind: 'mirror-play', style: 'tap' };
  await flow.wait(10);
  const post = await collect('post');
  state.mirror.offset = 0;
  const virtual: Point2 = {
    x: truth.x + state.mirror.plane.normal[0] * offset,
    z: truth.z + state.mirror.plane.normal[2] * offset,
  };
  const result = computeDrift(truth, virtual, pre, post);
  stage.card.hide();
  stage.board.draw(drawDrift(result, offset * 100, driftSentence(result)), 1.8);
  stage.board.show();
  sound.chime();
  void sound.say('drift-result');
  await flow.wait(7);
  stage.board.hide();
  return result;
}

/** Pain on a 0 to 10 scale with large minus, plus and done stones. */
export async function painCheck(which: 'before' | 'after', start: number, kind: 'pain' | 'stiff' = 'pain'): Promise<number> {
  flow.step = `pain-${which}`;
  let value = clamp(Math.round(start), 0, 10);
  stage.stone({ id: 'less', label: 'Less', icon: 'back' });
  stage.stone({ id: 'done', label: 'Done', icon: 'check', accent: PALETTE.good });
  stage.stone({ id: 'more', label: 'More', icon: 'next' });
  const title = kind === 'pain' ? 'Pain right now' : 'Stiffness this morning';
  const line = kind === 'pain' ? (which === 'before' ? 'pain-before' : 'pain-after') : 'stiff-before';
  const show = (speak: boolean) =>
    flow.say(speak ? line : null, { big: String(value), title, body: '0 is none, 10 is the worst you can imagine.' });
  show(true);
  stage.layoutStones(['less', 'done', 'more']);
  for (;;) {
    flow.expect = { kind: 'press', id: 'done' };
    const id = await stage.press.wait(['less', 'done', 'more']);
    sound.press();
    if (id === 'done') break;
    value = clamp(value + (id === 'more' ? 1 : -1), 0, 10);
    show(false);
  }
  stage.hideStones();
  return value;
}

export function otherSide(h: Handedness): Handedness {
  return otherHand(h);
}
