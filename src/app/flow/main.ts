/**
 * The app's top-level script: the first visit (the tour), and home for
 * returning users.
 */
import { APP_VERSION, newSessionId, ProgramId, SessionRecord } from '../../core/records.js';
import { sound } from '../audio.js';
import { PALETTE } from '../render/materials.js';
import { stage } from '../stage.js';
import { state } from '../state.js';
import { store } from '../store.js';
import { drawMessage } from '../ui/viz.js';
import { flow, FlowInterrupted } from './engine.js';
import { runProgram } from './programs.js';
import { setVoiceCommands } from './voice-control.js';
import { services } from './services.js';
import { showcaseChapter } from '../emulation/showcase-options.js';
import {
  chooseSide,
  embodimentCheck,
  findTable,
  handPrint,
  mirrorPlay,
  recordPrint,
  showHandPrint,
  startMirror,
  stopMirror,
} from './steps.js';

export function newRecord(program: ProgramId): SessionRecord {
  return {
    id: newSessionId(),
    startedAt: Date.now(),
    program,
    understudy: state.profile.understudy,
    appVersion: APP_VERSION,
    calibrationHash: calibrationHash(),
    metrics: {},
    exercises: [],
    completed: false,
    simulated: state.emulated || store.sandbox,
  };
}

function calibrationHash(): string {
  const s = state.station;
  const text = `${s.source}|${s.height.toFixed(2)}|${state.profile.understudy}|${state.hands.left.boneLengths[14].toFixed(3)}|${state.hands.right.boneLengths[14].toFixed(3)}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

export async function runApp(options: { fresh?: boolean } = {}): Promise<void> {
  const query = new URLSearchParams(location.search);
  const showcase = showcaseChapter(query, state.emulated);
  const requestedSeed = showcase ? 21 : Number(query.get('seed') ?? 0);
  const seedN = Number.isFinite(requestedSeed) ? Math.max(0, Math.min(56, Math.floor(requestedSeed))) : 0;
  await store.init({ sandbox: !!options.fresh || state.emulated || seedN > 0 });
  // demo: start from simulated history (?seed=21), marked as simulated on screen
  if (seedN > 0) {
    const { seedHistory } = await import('../emulation/seed.js');
    for (const r of seedHistory(seedN, 'left')) await store.saveSession(r);
    state.profile.understudy = 'left';
    state.profile.program = 'understudy';
    await store.saveProfile(state.profile);
  }
  const saved = await store.profile();
  if (saved) state.profile = saved;
  sound.voiceEnabled = state.profile.voice;
  if (state.profile.voiceCommands) setVoiceCommands(true);
  // demos and films can show the Playful style without visiting Settings
  if (store.sandbox && query.get('style') === 'playful') state.profile.style = 'playful';
  const records = await store.sessions();
  await findTable();
  if (showcase) {
    await (await import('../emulation/showcase.js')).runShowcase(showcase, records);
  }
  try {
    if (!saved || records.length === 0) await firstVisit(records);
  } catch (error) { await recover(error); }
  for (;;) {
    try { await home(); }
    catch (error) { await recover(error); }
  }
}

async function recover(error: unknown): Promise<void> {
  if (!(error instanceof FlowInterrupted)) throw error;
  const record = flow.currentRecord;
  if (record && !record.completed) {
    record.endedAt = Date.now();
    await store.saveSession(record);
  }
  flow.currentRecord = null;
  stopMirror();
  if (services.mirror) { services.mirror.forceWatch = true; services.mirror.attemptPhase = 'off'; }
  stage.hideStones();
  stage.board.hide();
  stage.meter.hide();
  for (const h of Object.values(stage.hands)) h.setVisible(false);
  await store.saveProfile(state.profile);
}

/** The First Five Minutes. */
async function firstVisit(records: SessionRecord[]): Promise<void> {
  flow.step = 'tour';
  const q = new URLSearchParams(location.search);
  const missing = q.get('missing');
  const side = await chooseSide(missing === 'left' || missing === 'right' ? missing : q.get('input') === 'left' ? 'right' : 'left');
  state.profile.program = await chooseProgram({ bothHands: side === 'both' });
  await store.saveProfile(state.profile);
  if (state.profile.program !== 'understudy') {
    await runProgram(state.profile.program);
    return;
  }
  const record = newRecord('understudy');
  flow.currentRecord = record;
  const pr = await handPrint(['left', 'right']);
  recordPrint(record, pr);
  await showHandPrint(pr, records);
  stage.board.hide();
  if (side !== 'both') {
    if (await startMirror()) {
      await mirrorPlay(20);
      // A position result needs a tracked resting hand as its reference.
      if (state.hands[state.profile.understudy!].valid) record.drift = await embodimentCheck();
      const felt = await feltQuestion();
      record.exercises.push({ id: `felt-${felt}`, seconds: 0, reps: 0 });
      stopMirror();
    }
  }
  record.understudy = state.profile.understudy;
  record.calibrationHash = calibrationHash();
  record.endedAt = Date.now();
  await store.saveProfile(state.profile);
  await runProgram(state.profile.program, { record, print: pr });
}

async function feltQuestion(): Promise<string> {
  stage.stone({ id: 'felt-yes', label: 'Yes', icon: 'check', accent: PALETTE.good });
  stage.stone({ id: 'felt-some', label: 'A little', icon: 'dot' });
  stage.stone({ id: 'felt-no', label: 'No', icon: 'stop', accent: PALETTE.caution });
  flow.say('feel-question', { icon: 'hand', title: 'Did it feel like your hand?' });
  const id = await flow.choose(['felt-yes', 'felt-some', 'felt-no'], 'felt-yes');
  return id.replace('felt-', '');
}

/** Programmes that train both working hands together, with no mirror. */
const BOTH_HANDS: ProgramId[] = ['warmup', 'deskbreak'];

export async function chooseProgram(options: { bothHands?: boolean } = {}): Promise<ProgramId> {
  flow.step = 'choose-program';
  stage.stone({ id: 'prog-understudy', label: 'Understudy', sub: 'weak hand', icon: 'mirror', accent: PALETTE.understudy });
  stage.stone({ id: 'prog-phantom', label: 'Phantom', sub: 'missing hand', icon: 'spark', accent: '#8b6fd6' });
  stage.stone({ id: 'prog-warmup', label: 'Warm-up', sub: 'stiff hands', icon: 'sun', accent: PALETTE.lead });
  stage.stone({ id: 'prog-deskbreak', label: 'Desk break', sub: 'busy hands', icon: 'hand', accent: PALETTE.good });
  const both = !!options.bothHands;
  stage.board.draw(
    drawMessage('Choose a daily programme', both ? [
      'Morning warm-up: stiff or sore hands.',
      'Desk break: two minutes for hands that type, click or play all day.',
    ] : [
      'Understudy: a hand that is weak after a stroke or injury.',
      'Phantom: pain or feeling in a missing hand.',
      'Warm-up: stiff or sore hands. Desk break: hands that work all day.',
    ]),
  );
  stage.board.show();
  flow.say('choose-program', { icon: 'touch', title: 'Choose a programme' });
  // the demo can be steered to a programme with ?program=
  const ids = both ? ['prog-warmup', 'prog-deskbreak'] : ['prog-understudy', 'prog-phantom', 'prog-warmup', 'prog-deskbreak'];
  const wanted = `prog-${new URLSearchParams(location.search).get('program') ?? (both ? 'warmup' : 'understudy')}`;
  const id = await flow.choose(ids, ids.includes(wanted) ? wanted : ids[0]);
  stage.board.hide();
  const program = id.replace('prog-', '') as ProgramId;
  if (BOTH_HANDS.includes(program)) {
    state.profile.understudy = null;
    return program;
  }
  if (state.profile.understudy === null) {
    if (await chooseSide('left') === 'both') return 'warmup';
  }
  return program;
}

const PROGRAM_SHORT: Record<ProgramId, string> = { understudy: 'Understudy', phantom: 'Phantom', warmup: 'Warm-up', deskbreak: 'Desk break' };

async function home(): Promise<void> {
  flow.step = 'home';
  flow.currentRecord = null;
  stage.stone({ id: 'home-today', label: 'Today', sub: 'session', icon: 'next', accent: PALETTE.good });
  stage.stone({ id: 'home-progress', label: 'Progress', icon: 'chart' });
  stage.stone({ id: 'home-program', label: 'Programme', sub: PROGRAM_SHORT[state.profile.program], icon: 'mirror' });
  stage.stone({ id: 'home-settings', label: 'Settings', icon: 'settings' });
  stage.stone({ id: 'home-later', label: 'Later visit', sub: 'sample', icon: 'chart', accent: PALETTE.understudy });
  stage.stone({ id: 'home-visit', label: 'Visit', sub: 'with someone', icon: 'hand', accent: '#8b6fd6' });
  flow.say('home-back', { icon: 'sun', title: 'Welcome back', body: store.sandbox && !state.film ? 'Temporary sample session. Personal history is safe.' : store.persistent || state.film ? 'Your table is ready.' : 'Storage unavailable. Export from Settings before leaving.' });
  const ids = ['home-today', 'home-progress', 'home-program', 'home-settings', 'home-later', 'home-visit'];
  stage.layoutStones(ids.slice(0, 4), 'far');
  // the near row sits between the wrists, clear of resting fingertips
  stage.layoutStones(ids.slice(4), 'near');
  // the demo can be steered to a home choice with ?goto=
  const goto = `home-${new URLSearchParams(location.search).get('goto') ?? 'today'}`;
  flow.expect = { kind: 'press', id: ids.includes(goto) && !homeVisited.has(goto) ? goto : 'home-today' };
  homeVisited.add(goto);
  const id = await stage.press.wait(ids);
  sound.press();
  flow.expect = { kind: 'idle' };
  await flow.wait(0.25);
  stage.hideStones();
  if (id === 'home-today') await runProgram(state.profile.program);
  else if (id === 'home-progress') await (await import('./progress.js')).showProgress();
  else if (id === 'home-program') {
    state.profile.program = await chooseProgram();
    await store.saveProfile(state.profile);
  } else if (id === 'home-later') await laterVisit();
  else if (id === 'home-visit') await (await import('./visit.js')).runVisit();
  else await (await import('./settings.js')).runSettings();
}

/** Home choices the demo has already taken, so `?goto=` steers only the first visit to home. */
const homeVisited = new Set<string>();

/**
 * A later visit, inside the headset: 21 simulated earlier visits in a
 * temporary store, then Progress and a complete session over that history,
 * so the per-finger handover can be seen on day one. Personal history is
 * never touched: it is reopened unchanged afterwards, and the sample record
 * is dropped even when the session is stopped.
 */
async function laterVisit(): Promise<void> {
  flow.step = 'later-visit';
  const profile = structuredClone(state.profile);
  const wasSandbox = store.sandbox;
  const before = wasSandbox ? await store.sessions() : [];
  const side = profile.understudy ?? 'left';
  stage.board.draw(drawMessage('A later visit', [
    'This shows visit 22 with 21 simulated earlier visits.',
    'The sample is labelled and temporary. Your own history is not changed.',
  ]));
  stage.board.show();
  flow.say('later-intro', { icon: 'chart', title: 'A later visit', body: 'Sample history, labelled. Yours is safe.' });
  await flow.wait(7);
  stage.board.hide();
  await store.init({ sandbox: true });
  const { seedHistory } = await import('../emulation/seed.js');
  for (const r of seedHistory(21, side)) await store.saveSession(r);
  state.profile = { ...profile, understudy: side, program: 'understudy' };
  await stage.setUnderstudySide(services.base);
  try {
    await (await import('./progress.js')).showProgress();
    await runProgram('understudy');
  } finally {
    // a stopped sample session must never be saved into personal history
    flow.currentRecord = null;
    await store.init({ sandbox: wasSandbox });
    for (const r of before) await store.saveSession(r);
    state.profile = profile;
    await stage.setUnderstudySide(services.base);
  }
}
