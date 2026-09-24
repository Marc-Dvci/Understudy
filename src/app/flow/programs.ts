/**
 * The three daily programmes.
 */
import { GmiSession, GmiStage, lateralityBlock, LateralityAnswer, nextGmiStage, Posture, scoreLaterality } from '../../core/gmi.js';
import { Handedness } from '../../core/joints.js';
import { METRICS, MetricId } from '../../core/measure.js';
import { q4, quatAxisAngle, quatMul, RAD, v3 } from '../../core/math.js';
import { fiveShares, metricKey, ProgramId, SessionRecord, sharesFromHistory } from '../../core/records.js';
import { gainFromRange, stageOf } from '../../core/rehearse.js';
import { buildPose, fistAngles, lerpAngles, neutralAngles, openAngles, restAngles, HandAngles } from '../../sim/handmodel.js';
import { pointAngles } from '../../sim/actor.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { store } from '../store.js';
import { drawMessage, drawMeter } from '../ui/viz.js';
import { captureRepPeak, warmupFrom } from './capture.js';
import { flow } from './engine.js';
import { flowerExercise, pianoExercise, tapExercise, thumbExercise } from './exercises.js';
import { newRecord } from './main.js';
import { showProgress } from './progress.js';
import { handPrint, mirrorPlay, painCheck, recordPrint, showHandPrint, startMirror, stopMirror } from './steps.js';
import { services } from './services.js';

export async function runProgram(p: ProgramId): Promise<void> {
  if (p === 'understudy') return understudySession();
  if (p === 'phantom') return phantomSession();
  return warmupSession();
}

async function finish(record: SessionRecord, lines: string[]): Promise<void> {
  record.endedAt = Date.now();
  record.completed = true;
  await store.saveSession(record);
  await store.saveProfile(state.profile);
  sound.chime();
  flow.say('session-done', { icon: 'check', title: 'Well done', body: 'That is today\'s session.', accent: PALETTE.good });
  await flow.wait(2.5);
  await showProgress();
  stage.board.draw(drawMessage('See you tomorrow', lines, PALETTE.good));
  stage.board.show();
  flow.say('come-back', { icon: 'sun', title: 'Come back tomorrow', body: 'Your table will be here.', accent: PALETTE.good });
  await flow.wait(4);
  stage.board.hide();
}

// ---------------------------------------------------------------- Understudy

async function understudySession(): Promise<void> {
  flow.step = 'understudy';
  if (!state.profile.understudy) state.profile.understudy = 'left';
  await stage.setUnderstudySide(services.base);
  const record = newRecord('understudy');
  const history = (await store.sessions()).filter((r) => r.completed);
  const pr = await handPrint(['left', 'right']);
  recordPrint(record, pr);
  await showHandPrint(pr, history);
  stage.board.hide();

  // shares from every session including today's
  const all = [...history, record];
  const fingerShares = sharesFromHistory(all, understudyHand());
  const shares = fiveShares(fingerShares);
  const fingers: MetricId[] = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'];
  const own = fingers.map((id) => record.metrics[metricKey(understudyHand(), id)]?.value ?? NaN);
  const ref = fingers.map((id) => record.metrics[metricKey(leadHand(), id)]?.value ?? NaN);
  state.mirror.controls.forEach((c, f) => {
    c.share = shares[f];
    const i = Math.max(0, f - 1);
    c.gain = gainFromRange(own[i], ref[i], c.share);
  });
  record.shares = shares;
  record.stage = stageOf(state.mirror.controls);

  if (!(await startMirror())) return;
  const mirror = services.mirror!;
  // learn how still the hidden hand is
  flow.expect = { kind: 'rest' };
  flow.say('attempt-rest', { icon: 'pause', title: 'Rest your hidden hand', body: 'Ten seconds. Keep it still.' });
  mirror.startAttemptCalibration(10);
  await flow.until(() => mirror.attemptPhase === 'on', 14);
  mirror.forceWatch = false;
  const stageLabel = record.stage === 'watch' ? 'Watch' : record.stage === 'perform' ? 'Perform' : 'Rehearse';
  const drawLive = () => {
    const gates = [0, 1, 2, 3, 4].map((f) => Math.max(mirror.handDetector.gate, mirror.fingerDetectors[f].gate));
    stage.meter.draw(drawMeter(shares, `${stageLabel}: % of each finger that is you`, gates));
  };
  drawLive();
  stage.meter.show();
  const liveTimer = { t: 0 };
  const tick = () => {
    liveTimer.t += 1;
    if (liveTimer.t % 6 === 0) drawLive();
    return false;
  };
  void flow.until(() => tick() || flow.step === 'done');

  flow.say('attempt-try', { icon: 'mirror', title: 'Try with both hands', body: 'Even a little movement counts.' });
  await flow.wait(3);
  const flower = await flowerExercise(6);
  const piano = await pianoExercise(8);
  const thumb = await thumbExercise(1);
  const taps = await tapExercise(10);
  record.exercises.push(
    { id: 'flower', seconds: 0, reps: flower.reps },
    { id: 'piano', seconds: 0, reps: piano.played },
    { id: 'thumb', seconds: 0, reps: thumb.touches },
    { id: 'tap', seconds: 10, reps: taps[leadHand()].taps },
  );
  for (const h of ['left', 'right'] as Handedness[]) {
    const put = (id: MetricId, value: number) => {
      if (Number.isFinite(value)) record.metrics[metricKey(h, id)] = { value, trials: [value], validShare: 1 };
    };
    put('individuation', piano.individuation[h]);
    put('tap.rate', taps[h].rate);
    put('tap.amplitude', taps[h].amplitude);
    put('tap.decrement', taps[h].decrement);
  }
  flow.step = 'done';
  stopMirror();
  mirror.forceWatch = true;
  mirror.attemptPhase = 'off';
  stage.meter.hide();
  const sharePct = Math.round((shares.slice(1).reduce((a, b) => a + b, 0) / 4) * 100);
  await finish(record, [
    `Your ${understudyHand()} hand performed ${sharePct}% of its own movement today.`,
    'The share only moves when a change is bigger than the margin of error.',
  ]);
}

// ------------------------------------------------------------------ Phantom

async function phantomSession(): Promise<void> {
  flow.step = 'phantom';
  if (!state.profile.understudy) state.profile.understudy = 'left';
  await stage.setUnderstudySide(services.base);
  const record = newRecord('phantom');
  const history = (await store.sessions()).filter((r) => r.program === 'phantom' && r.completed);
  const gmiHistory: GmiSession[] = history.map((r) => ({
    stage: (r.stage as GmiStage) ?? 'recognise',
    painBefore: r.painBefore ?? 0,
    painAfter: r.painAfter ?? 0,
    laterality: r.laterality,
    completed: r.completed,
  }));
  const decision = nextGmiStage(gmiHistory);
  const lastPain = history.length ? history[history.length - 1].painAfter ?? 3 : 3;
  record.painBefore = await painCheck('before', lastPain);
  record.stage = decision.stage;
  stage.board.draw(
    drawMessage(`Today: ${decision.stage === 'recognise' ? 'Recognise' : decision.stage === 'imagine' ? 'Imagine' : 'Mirror'}`, [
      'Graded motor imagery: recognise, then imagine, then mirror.',
      decision.reason,
    ], '#8b6fd6'),
  );
  stage.board.show();
  await flow.wait(3.5);
  stage.board.hide();

  if (decision.stage === 'recognise') record.laterality = await recogniseBlock(record.id);
  else if (decision.stage === 'imagine') await imagineBlock();
  else await phantomMirror();

  record.painAfter = await painCheck('after', record.painBefore ?? 3);
  record.metrics[metricKey(understudyHand(), 'pain')] = { value: record.painAfter, trials: [record.painAfter], validShare: 1 };
  const delta = (record.painAfter ?? 0) - (record.painBefore ?? 0);
  await finish(record, [
    `Pain ${record.painBefore} before, ${record.painAfter} after (${delta > 0 ? '+' : ''}${delta}).`,
    delta >= 2 ? 'Pain rose today. If it rises again, the next session steps back one stage.' : 'Three steady sessions move you to the next stage.',
  ]);
}

const POSTURE_ANGLES: Record<Posture, () => HandAngles> = {
  open: openAngles,
  fist: fistAngles,
  point: pointAngles,
  pinch: () => {
    const a = restAngles();
    a.fingers[0] = { mcpFlex: 45, mcpAbd: 0, pipFlex: 50, dipFlex: 20 };
    a.thumb = { cmcFlex: 40, cmcAbd: 30, mcpFlex: 30, ipFlex: 20 };
    return a;
  },
  spread: () => {
    const a = openAngles();
    a.fingers.forEach((f, i) => (f.mcpAbd = [18, 4, -10, -26][i]));
    return a;
  },
  thumb: () => {
    const a = fistAngles();
    a.thumb = { cmcFlex: -15, cmcAbd: 45, mcpFlex: 0, ipFlex: 0 };
    return a;
  },
};

async function recogniseBlock(seed: string): Promise<ReturnType<typeof scoreLaterality>> {
  flow.step = 'recognise';
  const stim = lateralityBlock(hash(seed), 16);
  stage.stone({ id: 'lat-left', label: 'Left', icon: 'left', accent: '#8b6fd6' });
  stage.stone({ id: 'lat-right', label: 'Right', icon: 'right', accent: '#8b6fd6' });
  flow.say('recognise-intro', { icon: 'hand', title: 'Left or right hand?', body: 'Answer as quickly as you can.' });
  await flow.wait(2.5);
  stage.layoutStones(['lat-left', 'lat-right']);
  const answers: LateralityAnswer[] = [];
  const center = stage.toWorld(0, 0.02, 0.16);
  for (let i = 0; i < stim.length; i++) {
    const s = stim[i];
    const model = s.hand === 'left' ? stage.hands.demoLeft : stage.hands.demoRight;
    const other = s.hand === 'left' ? stage.hands.demoRight : stage.hands.demoLeft;
    other.setVisible(false);
    const q = quatMul(
      q4(),
      quatAxisAngle(q4(), v3(0, 1, 0), (s.yaw + Math.atan2(-state.station.forward[0], -state.station.forward[2]) / RAD) * RAD),
      quatMul(q4(), quatAxisAngle(q4(), v3(1, 0, 0), s.pitch * RAD), quatAxisAngle(q4(), v3(0, 0, 1), (s.roll + (s.palmUp ? 180 : 0)) * RAD)),
    );
    const pose = buildPose(POSTURE_ANGLES[s.posture](), s.hand, { length: 0.19 }, { position: v3(center.x, center.y, center.z), orientation: q });
    // centre the hand on its palm
    const pc = v3((pose[12] + pose[11 * 16 + 12]) / 2, (pose[13] + pose[11 * 16 + 13]) / 2, (pose[14] + pose[11 * 16 + 14]) / 2);
    for (let j = 0; j < 25; j++) {
      pose[j * 16 + 12] += center.x - pc[0];
      pose[j * 16 + 13] += center.y - pc[1];
      pose[j * 16 + 14] += center.z - pc[2];
    }
    model.setMaterial(stage.skin);
    model.apply(pose);
    model.setVisible(true);
    flow.say(null, { icon: 'hand', title: 'Left or right hand?', step: { index: i, total: stim.length } });
    const t0 = flow.time;
    flow.expect = { kind: 'press', id: s.hand === 'left' ? 'lat-left' : 'lat-right' };
    let answer: string | null = null;
    const got = stage.press.wait(['lat-left', 'lat-right']).then((id) => (answer = id));
    await flow.until(() => answer !== null, 8);
    void got;
    model.setVisible(false);
    const correct = answer === (s.hand === 'left' ? 'lat-left' : 'lat-right');
    if (answer) sound.chime(undefined, correct);
    answers.push({ stimulus: s, answer: answer ? (answer === 'lat-left' ? 'left' : 'right') : null, rt: flow.time - t0 });
    await flow.wait(0.5);
  }
  stage.hideStones();
  const score = scoreLaterality(answers);
  stage.board.draw(
    drawMessage(`${Math.round(score.accuracy * 100)}% correct`, [
      `Left hands ${Math.round(score.accuracyLeft * 100)}%, ${score.rtLeft.toFixed(2)} s.`,
      `Right hands ${Math.round(score.accuracyRight * 100)}%, ${score.rtRight.toFixed(2)} s.`,
      'Moving on needs 80% and a similar speed on both sides.',
    ], '#8b6fd6'),
  );
  stage.board.show();
  await flow.wait(5);
  stage.board.hide();
  return score;
}

async function imagineBlock(): Promise<void> {
  flow.step = 'imagine';
  const postures: Posture[] = ['open', 'fist', 'point', 'spread', 'pinch', 'thumb'];
  stage.stone({ id: 'imagine-done', label: 'Done', icon: 'check', accent: PALETTE.good });
  const model = understudyHand() === 'left' ? stage.hands.demoLeft : stage.hands.demoRight;
  const place = stage.toWorld(0, 0.02, 0.11);
  const f = state.station.forward;
  const q = quatAxisAngle(q4(), v3(0, 1, 0), Math.atan2(-f[0], -f[2]));
  flow.say('imagine-intro', { icon: 'eye', title: 'Watch, then imagine', body: 'Keep your other hand still.' });
  for (let i = 0; i < postures.length; i++) {
    const target = POSTURE_ANGLES[postures[i]]();
    const rest = restAngles();
    model.setMaterial(stage.skin);
    model.setVisible(true);
    stage.layoutStones(['imagine-done']);
    flow.say(i === 0 ? null : null, { icon: 'eye', title: 'Imagine your hand doing this', step: { index: i, total: postures.length } });
    flow.expect = { kind: 'press', id: 'imagine-done' };
    let done = false;
    const pressed = stage.press.wait(['imagine-done']).then(() => (done = true));
    const start = flow.time;
    const cur = neutralAngles();
    await flow.until(() => {
      const t = flow.time - start;
      const k = 0.5 - 0.5 * Math.cos((t * 2 * Math.PI) / 4);
      lerpAngles(rest, target, k, cur);
      model.apply(buildPose(cur, understudyHand(), { length: 0.19 }, { position: v3(place.x, place.y, place.z + 0.06), orientation: q }));
      return done && t > 3;
    }, 30);
    void pressed;
    sound.press();
  }
  model.setVisible(false);
  stage.hideStones();
}

async function phantomMirror(): Promise<void> {
  flow.step = 'phantom-mirror';
  flow.say('residual-touch', { icon: 'touch', title: 'Touch the end of your arm', body: 'Then hold still for a moment.' });
  const lead = state.hands[leadHand()];
  const point = v3();
  let still = 0;
  await flow.until(() => {
    if (!lead.valid) return false;
    if (lead.indexTipSpeed < 0.03) still += 1 / 72;
    else still = 0;
    return still > 1;
  }, 30);
  // the virtual hand sits where the hand would be: 9 cm beyond the touched point
  const f = state.station.forward;
  point[0] = lead.indexTip[0] + f[0] * 0.09;
  point[1] = state.station.height;
  point[2] = lead.indexTip[2] + f[2] * 0.09;
  services.mirror?.calibrateToPoint(point);
  state.mirror.active = true;
  services.mirror!.forceWatch = true;
  stage.mat.showMidline = true;
  stage.mat.markDirty();
  await mirrorPlay(30);
  stopMirror();
}

// ---------------------------------------------------------------- Warm-up

async function warmupSession(): Promise<void> {
  flow.step = 'warmup';
  const record = newRecord('warmup');
  const history = (await store.sessions()).filter((r) => r.completed);
  const last = history.length ? history[history.length - 1].stiffnessSelf ?? 3 : 3;
  record.stiffnessSelf = await painCheck('before', last, 'stiff');

  // warm-up curve: ten slow fists, measured before the routine warms the hands
  flow.say('warmup-measure', { icon: 'fist', title: 'Ten slow fists', body: 'I measure how your hands warm up.' });
  await flow.wait(2.5);
  const ranges: Record<Handedness, number[]> = { left: [], right: [] };
  for (let r = 0; r < 10; r++) {
    flow.expect = { kind: 'warmup-fist', rep: r };
    flow.say(null, { icon: 'fist', title: 'Close', step: { index: r, total: 10 } });
    flow.expect = { kind: 'move', movement: 'fist', hands: ['left', 'right'] };
    const [pl, pr] = await Promise.all([captureRepPeak('left', 1.6), captureRepPeak('right', 1.6)]);
    ranges.left.push(pl);
    ranges.right.push(pr);
    flow.expect = { kind: 'move', movement: 'open', hands: ['left', 'right'] };
    flow.say(null, { icon: 'open', title: 'Open', step: { index: r, total: 10 } });
    await flow.wait(1.2);
  }
  const fits = { left: warmupFrom(ranges.left), right: warmupFrom(ranges.right) };
  for (const h of ['left', 'right'] as Handedness[]) {
    const fit = fits[h];
    if (fit) record.metrics[metricKey(h, 'warmup.stiffness')] = { value: fit.stiffness, trials: [fit.stiffness], validShare: 1 };
  }
  record.warmup = { ranges: ranges.left.map((l, i) => (l + ranges.right[i]) / 2), fit: warmupFrom(ranges.left.map((l, i) => (l + ranges.right[i]) / 2)) };

  // routine
  flow.say('warmup-routine', { icon: 'hand', title: 'Five gentle movements', body: 'Follow the hand.' });
  const moves: { title: string; target: HandAngles }[] = [
    { title: 'Straight fingers, bend at the knuckles', target: (() => { const a = openAngles(); a.fingers.forEach((f) => { f.mcpFlex = 80; f.pipFlex = 0; f.dipFlex = 0; }); return a; })() },
    { title: 'Hook fist', target: (() => { const a = openAngles(); a.fingers.forEach((f) => { f.mcpFlex = 0; f.pipFlex = 95; f.dipFlex = 70; }); return a; })() },
    { title: 'Full fist', target: fistAngles() },
    { title: 'Spread your fingers', target: POSTURE_ANGLES.spread() },
    { title: 'Thumb across the palm', target: (() => { const a = openAngles(); a.thumb = { cmcFlex: 55, cmcAbd: 25, mcpFlex: 45, ipFlex: 40 }; return a; })() },
  ];
  const demo = stage.hands.demoRight;
  const place = stage.toWorld(0, 0.03, 0.1);
  const f = state.station.forward;
  const q = quatAxisAngle(q4(), v3(0, 1, 0), Math.atan2(-f[0], -f[2]));
  demo.setMaterial(stage.ghost);
  demo.setVisible(true);
  for (let i = 0; i < moves.length; i++) {
    flow.say(null, { icon: 'hand', title: moves[i].title, step: { index: i, total: moves.length } });
    flow.expect = { kind: 'move', movement: i === 2 ? 'fist' : 'open', hands: ['left', 'right'] };
    const start = flow.time;
    const cur = neutralAngles();
    await flow.until(() => {
      const t = flow.time - start;
      const k = 0.5 - 0.5 * Math.cos((t * 2 * Math.PI) / 3);
      lerpAngles(openAngles(), moves[i].target, k, cur);
      demo.apply(buildPose(cur, 'right', { length: 0.19 }, { position: v3(place.x, place.y, place.z), orientation: q }));
      return t >= 9;
    });
  }
  demo.setVisible(false);
  record.exercises.push({ id: 'routine', seconds: 45, reps: 15 });

  const pr = await handPrint(['left', 'right'], 2);
  recordPrint(record, pr);
  await showHandPrint(pr, history);
  stage.board.hide();
  const s = (h: Handedness) => fits[h]?.stiffness;
  const sl = s('left');
  const sr = s('right');
  await finish(record, [
    `Morning stiffness: left ${Number.isFinite(sl) ? Math.round(sl!) : '--'}%, right ${Number.isFinite(sr) ? Math.round(sr!) : '--'}% of range missing at the first fist.`,
    `Hands reach 90% of their warm range after ${fits.right ? fits.right.repsTo90.toFixed(1) : '--'} fists.`,
  ]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { METRICS };
