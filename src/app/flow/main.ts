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
  const side = await chooseSide(q.get('input') === 'left' ? 'right' : 'left');
  state.profile.program = side === 'both' ? 'warmup' : await chooseProgram();
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

export async function chooseProgram(): Promise<ProgramId> {
  flow.step = 'choose-program';
  stage.stone({ id: 'prog-understudy', label: 'Understudy', sub: 'weak hand', icon: 'mirror', accent: PALETTE.understudy });
  stage.stone({ id: 'prog-phantom', label: 'Phantom', sub: 'missing hand', icon: 'spark', accent: '#8b6fd6' });
  stage.stone({ id: 'prog-warmup', label: 'Warm-up', sub: 'stiff hands', icon: 'sun', accent: PALETTE.lead });
  stage.board.draw(
    drawMessage('Choose a daily programme', [
      'Understudy: a hand that is weak after a stroke or injury.',
      'Phantom: pain or feeling in a missing hand.',
      'Morning warm-up: stiff or sore hands.',
    ]),
  );
  stage.board.show();
  flow.say('choose-program', { icon: 'touch', title: 'Choose a programme' });
  // the demo can be steered to a programme with ?program=
  const wanted = new URLSearchParams(location.search).get('program') ?? 'understudy';
  const id = await flow.choose(['prog-understudy', 'prog-phantom', 'prog-warmup'], `prog-${wanted}`);
  stage.board.hide();
  if (id !== 'prog-warmup' && state.profile.understudy === null) {
    if (await chooseSide('left') === 'both') return 'warmup';
  }
  return id.replace('prog-', '') as ProgramId;
}

const PROGRAM_SHORT: Record<ProgramId, string> = { understudy: 'Understudy', phantom: 'Phantom', warmup: 'Warm-up' };

async function home(): Promise<void> {
  flow.step = 'home';
  flow.currentRecord = null;
  stage.stone({ id: 'home-today', label: 'Today', sub: 'session', icon: 'next', accent: PALETTE.good });
  stage.stone({ id: 'home-progress', label: 'Progress', icon: 'chart' });
  stage.stone({ id: 'home-program', label: 'Programme', sub: PROGRAM_SHORT[state.profile.program], icon: 'mirror' });
  stage.stone({ id: 'home-settings', label: 'Settings', icon: 'settings' });
  flow.say('home-back', { icon: 'sun', title: 'Welcome back', body: store.sandbox ? 'Temporary sample session. Personal history is safe.' : store.persistent ? 'Your table is ready.' : 'Storage unavailable. Export from Settings before leaving.' });
  const id = await flow.choose(['home-today', 'home-progress', 'home-program', 'home-settings'], 'home-today');
  if (id === 'home-today') await runProgram(state.profile.program);
  else if (id === 'home-progress') await (await import('./progress.js')).showProgress();
  else if (id === 'home-program') {
    state.profile.program = await chooseProgram();
    await store.saveProfile(state.profile);
  } else await (await import('./settings.js')).runSettings();
}
