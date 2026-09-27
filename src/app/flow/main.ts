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
import { flow } from './engine.js';
import { runProgram } from './programs.js';
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
  await store.init();
  if (options.fresh) await store.clear();
  // demo: start from simulated history (?seed=21), marked as simulated on screen
  const seedN = Number(new URLSearchParams(location.search).get('seed') ?? 0);
  if (options.fresh && seedN > 0) {
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
  if (!saved || records.length === 0) await firstVisit(records);
  for (;;) await home();
}

/** The First Five Minutes. */
async function firstVisit(records: SessionRecord[]): Promise<void> {
  flow.step = 'tour';
  const record = newRecord('understudy');
  const q = new URLSearchParams(location.search);
  const side = await chooseSide(q.get('input') === 'left' ? 'right' : 'left');
  const pr = await handPrint(['left', 'right']);
  recordPrint(record, pr);
  await showHandPrint(pr, records);
  stage.board.hide();
  if (side !== 'both') {
    if (await startMirror()) {
      await mirrorPlay(20);
      record.drift = await embodimentCheck();
      const felt = await feltQuestion();
      record.exercises.push({ id: `felt-${felt}`, seconds: 0, reps: 0 });
      stopMirror();
    }
  }
  record.understudy = state.profile.understudy;
  record.calibrationHash = calibrationHash();
  record.endedAt = Date.now();
  record.completed = true;
  await store.saveSession(record);
  state.profile.program = await chooseProgram();
  await store.saveProfile(state.profile);
  await runProgram(state.profile.program, side !== 'both' ? { record, print: pr } : undefined);
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
  return id.replace('prog-', '') as ProgramId;
}

async function home(): Promise<void> {
  flow.step = 'home';
  stage.stone({ id: 'home-today', label: 'Today', sub: 'session', icon: 'next', accent: PALETTE.good });
  stage.stone({ id: 'home-progress', label: 'Progress', icon: 'chart' });
  stage.stone({ id: 'home-settings', label: 'Settings', icon: 'settings' });
  flow.say('home-back', { icon: 'sun', title: 'Welcome back', body: 'Your table is ready.' });
  const id = await flow.choose(['home-today', 'home-progress', 'home-settings'], 'home-today');
  if (id === 'home-today') await runProgram(state.profile.program);
  else if (id === 'home-progress') await (await import('./progress.js')).showProgress();
  else await (await import('./settings.js')).runSettings();
}
