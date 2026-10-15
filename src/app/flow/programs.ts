/**
 * The three daily programmes.
 */
import { GmiSession, GmiStage, lateralityBlock, LateralityAnswer, nextGmiStage, Posture, scoreLaterality } from '../../core/gmi.js';
import { assistanceForSession } from '../../core/assistance.js';
import { Handedness } from '../../core/joints.js';
import { METRICS, MetricId } from '../../core/measure.js';
import { q4, quatAxisAngle, quatMul, RAD, v3 } from '../../core/math.js';
import { historyFor, metricKey, ProgramId, SessionRecord } from '../../core/records.js';
import { stageOf } from '../../core/rehearse.js';
import { buildPose, fistAngles, lerpAngles, neutralAngles, openAngles, restAngles, HandAngles } from '../../sim/handmodel.js';
import { pointAngles } from '../../sim/actor.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { leadHand, state, understudyHand } from '../state.js';
import { store } from '../store.js';
import { drawMessage, drawMeter, drawTomorrow } from '../ui/viz.js';
import { EXERCISE_LABEL, ExerciseId, explainAssistance, planRoutine, programmeHints, visitDays } from '../../core/coach.js';
import { bothSides, dialExercise, mirrorSides, Side, spreadExercise, stonesExercise, waveExercise } from './exercises-more.js';
import { captureRepPeak, warmupFrom } from './capture.js';
import { flow } from './engine.js';
import { flowerExercise, pianoExercise, tapExercise, thumbExercise } from './exercises.js';
import { newRecord } from './main.js';
import { showProgress } from './progress.js';
import { handPrint, mirrorPlay, painCheck, PrintResult, recordPrint, showHandPrint, startMirror, stopMirror } from './steps.js';
import { services } from './services.js';

/** A Hand Print taken moments ago in the same visit, carried into the session. */
export interface CarriedPrint {
  record: SessionRecord;
  print: PrintResult;
}

export async function runProgram(p: ProgramId, carried?: CarriedPrint): Promise<void> {
  if (p === 'understudy') return understudySession(carried);
  if (p === 'phantom') return phantomSession();
  if (p === 'deskbreak') return deskBreakSession();
  return warmupSession();
}

async function finish(record: SessionRecord, lines: string[]): Promise<void> {
  flow.step = 'done';
  record.endedAt = Date.now();
  record.completed = true;
  await store.saveSession(record);
  await store.saveProfile(state.profile);
  sound.chime();
  flow.say('session-done', { icon: 'check', title: 'Well done', body: store.persistent || state.film ? 'Today is saved on this headset.' : store.sandbox ? 'Sample session complete.' : 'Session complete. Storage unavailable; export before leaving.', accent: PALETTE.good });
  await flow.wait(2.5);
  await showProgress();
  stage.board.draw(drawMessage('Today', lines, PALETTE.good));
  stage.board.show();
  await flow.wait(4);
  // what the next visit can change, from the same margins, and the visited days
  flow.step = 'next-visit';
  const all = await store.sessions();
  stage.board.draw(drawTomorrow('Next visit', programmeHints(all, record.program, record.understudy), visitDays(all.filter((r) => r.program === record.program), Date.now())));
  flow.say('come-back', { icon: 'sun', title: 'Come back tomorrow', body: 'Your table will be here.', accent: PALETTE.good });
  await flow.wait(6);
  stage.board.hide();
}

/** Shows a short list of sentences on the board for `seconds`. */
async function notes(title: string, lines: string[], seconds: number, accent = PALETTE.understudy): Promise<void> {
  stage.board.draw(drawTomorrow(title, lines, [], accent));
  stage.board.show();
  await flow.wait(seconds);
  stage.board.hide();
}

/** Runs planned exercises and records each one's repetitions and measurements. */
async function runRoutine(ids: ExerciseId[], sides: Side[], record: SessionRecord): Promise<void> {
  const put = (h: Handedness, id: MetricId, value: number, validShare: number) => {
    record.metrics[metricKey(h, id)] = { value, trials: [value], validShare };
  };
  const finite = (p: Record<Handedness, number>) => {
    const out: Partial<Record<Handedness, number>> = {};
    for (const h of ['left', 'right'] as Handedness[]) if (Number.isFinite(p[h])) out[h] = Math.round(p[h] * 10) / 10;
    return out;
  };
  for (const id of ids) {
    if (id === 'flower') {
      const flower = await flowerExercise(6);
      record.exercises.push({ id, seconds: 0, reps: flower.reps });
    } else if (id === 'piano') {
      const piano = await pianoExercise(8);
      record.exercises.push({ id, seconds: 0, reps: piano.played });
      for (const h of ['left', 'right'] as Handedness[]) put(h, 'individuation', piano.individuation[h], piano.validShare[h]);
    } else if (id === 'thumb') {
      const thumb = await thumbExercise(1);
      record.exercises.push({ id, seconds: 0, reps: thumb.touches });
    } else if (id === 'tap') {
      const taps = await tapExercise(10);
      record.exercises.push({ id, seconds: 10, reps: taps[leadHand()].taps });
      for (const h of ['left', 'right'] as Handedness[]) {
        put(h, 'tap.rate', taps[h].rate, taps[h].validShare);
        put(h, 'tap.amplitude', taps[h].amplitude, taps[h].validShare);
        put(h, 'tap.decrement', taps[h].decrement, taps[h].validShare);
      }
    } else {
      const run = id === 'stones' ? stonesExercise(sides, sides.some((s) => s.mirrored) ? 3 : 2)
        : id === 'dial' ? dialExercise(sides) : id === 'spread' ? spreadExercise(sides) : waveExercise(sides);
      const r = await run;
      record.exercises.push({ id, seconds: 0, reps: r.reps, peaks: finite(r.peaks) });
    }
  }
}

// ---------------------------------------------------------------- Understudy

async function understudySession(carried?: CarriedPrint): Promise<void> {
  flow.step = 'understudy';
  if (!state.profile.understudy) state.profile.understudy = 'left';
  await stage.setUnderstudySide(services.base);
  // on the first visit the tour's Hand Print is today's: the session goes
  // straight on to the exercises instead of measuring the same hands again
  const record = carried?.record ?? newRecord('understudy');
  flow.currentRecord = record;
  const history = historyFor(await store.sessions(), 'understudy', state.profile.understudy).filter((r) => r.id !== record.id);
  if (!carried) {
    const pr = await handPrint(['left', 'right']);
    recordPrint(record, pr);
    await showHandPrint(pr, history);
    stage.board.hide();
  }

  const measuredControls = assistanceForSession(history, record, understudyHand());
  const shares = measuredControls.map((control) => control.share);
  state.mirror.controls.forEach((c, f) => {
    c.share = measuredControls[f].share;
    c.gain = measuredControls[f].gain;
  });
  record.shares = shares;
  record.stage = stageOf(state.mirror.controls);

  // the coach: today's routine from the measurements, and why each finger has its setting
  const plan = planRoutine(history, understudyHand());
  flow.step = 'coach-plan';
  flow.say('coach-plan', { icon: 'next', title: "Today's plan", body: plan.exercises.map((id) => EXERCISE_LABEL[id]).join(', ') });
  await notes("Today's plan", [plan.exercises.map((id) => EXERCISE_LABEL[id]).join(' · '), ...plan.reasons], 5.5);
  flow.step = 'coach-why';
  flow.say('coach-why', { icon: 'mirror', title: 'Why these settings', body: 'Each finger moves on its own measurement.' });
  await notes('Why these settings', explainAssistance(history, record, understudyHand()), 7);

  if (!(await startMirror())) {
    flow.say(null, { icon: 'hand', title: 'Bring your Lead hand into view', body: 'Return home and try again when tracking is ready.' });
    await flow.wait(4);
    return;
  }
  const mirror = services.mirror!;
  // learn how still the hidden hand is
  flow.expect = { kind: 'rest' };
  flow.say('attempt-rest', { icon: 'pause', title: 'Rest your hidden hand', body: 'Ten seconds. Keep it still.' });
  mirror.startAttemptCalibration(10);
  await flow.until(() => mirror.attemptPhase === 'on', 14);
  mirror.forceWatch = mirror.attemptPhase !== 'on';
  const stageLabel = record.stage === 'watch' ? 'Watch' : record.stage === 'perform' ? 'Perform' : 'Rehearse';
  const drawLive = () => {
    const gates = [0, 1, 2, 3, 4].map((f) => Math.max(mirror.handDetector.gate, mirror.fingerDetectors[f].gate));
    stage.meter.draw(drawMeter(shares, `${stageLabel}: your own share`, gates));
  };
  drawLive();
  stage.meter.show();
  const liveTimer = { t: 0 };
  const tick = () => {
    liveTimer.t += 1;
    if (liveTimer.t % 6 === 0) drawLive();
    return false;
  };
  void flow.until(() => tick() || flow.step === 'done').catch(() => undefined);

  flow.say('attempt-try', { icon: 'mirror', title: 'Try with both hands', body: 'Even a little movement counts.' });
  await flow.wait(3);
  await runRoutine(plan.exercises, mirrorSides(), record);
  stopMirror();
  mirror.forceWatch = true;
  mirror.attemptPhase = 'off';
  stage.meter.hide();
  const sharePct = Math.round((shares.slice(1).reduce((a, b) => a + b, 0) / 4) * 100);
  await finish(record, [
    `The mirror used a ${sharePct}% own-movement setting today.`,
    'The share only moves when a change is bigger than the margin of error.',
  ]);
}

// ------------------------------------------------------------------ Phantom

async function phantomSession(): Promise<void> {
  flow.step = 'phantom';
  if (!state.profile.understudy) state.profile.understudy = 'left';
  await stage.setUnderstudySide(services.base);
  const record = newRecord('phantom');
  flow.currentRecord = record;
  const history = historyFor(await store.sessions(), 'phantom', state.profile.understudy);
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
  // on the near half of the mat, low enough that no rotation reaches the card
  const center = stage.toWorld(0, -0.04, 0.085);
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
    const off = stage.press.onPress((id) => { if (id === 'lat-left' || id === 'lat-right') answer = id; });
    try { await flow.until(() => answer !== null, 8); }
    finally { off(); }
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
    const off = stage.press.onPress((id) => { if (id === 'imagine-done') done = true; });
    const start = flow.time;
    const cur = neutralAngles();
    try { await flow.until(() => {
      const t = flow.time - start;
      const k = 0.5 - 0.5 * Math.cos((t * 2 * Math.PI) / 4);
      lerpAngles(rest, target, k, cur);
      model.apply(buildPose(cur, understudyHand(), { length: 0.19 }, { position: v3(place.x, place.y, place.z + 0.06), orientation: q }));
      return done && t > 3;
    }, 30); } finally { off(); }
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
  flow.currentRecord = record;
  const history = historyFor(await store.sessions(), 'warmup', state.profile.understudy);
  const last = history.length ? history[history.length - 1].stiffnessSelf ?? 3 : 3;
  record.stiffnessSelf = await painCheck('before', last, 'stiff');

  // warm-up curve: ten slow fists, measured before the routine warms the hands
  flow.say('warmup-measure', { icon: 'fist', title: 'Ten slow fists', body: 'I measure how your hands warm up.' });
  await flow.wait(2.5);
  const ranges: Record<Handedness, number[]> = { left: [], right: [] };
  for (let r = 0; r < 10; r++) {
    flow.say(null, { icon: 'fist', title: 'Close', step: { index: r, total: 10 } });
    flow.expect = { kind: 'move', movement: 'fist', hands: ['left', 'right'], rep: r };
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

// --------------------------------------------------------------- Desk break

/**
 * Two minutes for two working hands that type, click or play all day:
 * measure, four movements against the table, then the same margins as every
 * programme decide what counts as a change.
 */
async function deskBreakSession(): Promise<void> {
  flow.step = 'deskbreak';
  state.profile.understudy = null;
  const record = newRecord('deskbreak');
  record.understudy = null;
  flow.currentRecord = record;
  const history = historyFor(await store.sessions(), 'deskbreak', null);
  await flow.tell('desk-intro', { icon: 'hand', title: 'Desk break', body: 'Two minutes for hands that work all day.' }, 6);
  const pr = await handPrint(['left', 'right'], 2);
  recordPrint(record, pr);
  await showHandPrint(pr, history);
  stage.board.hide();
  const plan: ExerciseId[] = ['spread', 'wave', 'dial', 'stones'];
  await notes('Your break', [plan.map((id) => EXERCISE_LABEL[id]).join(' · '), 'Move within comfort. Nothing here is timed.'], 4, PALETTE.lead);
  await runRoutine(plan, bothSides(), record);
  const total = (h: Handedness) => record.metrics[metricKey(h, 'tam.total')]?.value;
  const fmt = (v: number | undefined) => (Number.isFinite(v) ? `${Math.round(v!)}°` : '--');
  const turn = record.exercises.find((e) => e.id === 'dial')?.peaks;
  await finish(record, [
    `Whole-hand range: left ${fmt(total('left'))}, right ${fmt(total('right'))}.`,
    `Forearm turn: left ${fmt(turn?.left)}, right ${fmt(turn?.right)}.`,
  ]);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export { METRICS };
