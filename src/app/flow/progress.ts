/**
 * Progress: the metrics that matter for the programme, each against its
 * usual range, with only real changes (bigger than the MDC) marked.
 */
import { Matrix4, Vector3 } from '@iwsdk/core';
import { Handedness } from '../../core/joints.js';
import { MetricId } from '../../core/measure.js';
import { historyFor, progressFor, seriesFor, metricKey, SessionRecord } from '../../core/records.js';
import { sound } from '../audio.js';
import { stage } from '../stage.js';
import { state, understudyHand } from '../state.js';
import { store } from '../store.js';
import { drawMessage, drawProgress, ProgressRow } from '../ui/viz.js';
import { PALETTE } from '../render/materials.js';
import { flow } from './engine.js';

export async function showProgress(options: { hold?: boolean } = {}): Promise<void> {
  flow.step = 'progress';
  const program = state.profile.program;
  const records = historyFor(await store.sessions(), program, state.profile.understudy);
  const rows: ProgressRow[] = [];
  const add = (hand: Handedness, id: MetricId, label: string) => {
    const p = progressFor(records, hand, id);
    if (p.sessions === 0) return;
    rows.push({
      label,
      unit: p.def.unit === 'deg' ? '°' : p.def.unit === '%' ? '%' : '',
      values: seriesFor(records, metricKey(hand, id)).filter(Number.isFinite),
      band: p.usual ? [p.usual.low, p.usual.high] : null,
      change: p.change,
      latest: p.latest,
      mdc: p.error.mdc,
    });
  };
  const us = understudyHand();
  if (program === 'understudy') {
    add(us, 'tam.index', 'Index finger range');
    add(us, 'tam.middle', 'Middle finger range');
    add(us, 'tam.total', 'Whole-hand range');
    add(us, 'opening', 'Hand opening');
  } else if (program === 'phantom') {
    add(us, 'pain', 'Pain after the session');
  } else if (program === 'deskbreak') {
    add('right', 'tam.total', 'Whole-hand range, right');
    add('left', 'tam.total', 'Whole-hand range, left');
    add('right', 'spread', 'Finger spread, right');
    add('left', 'spread', 'Finger spread, left');
  } else {
    add('right', 'warmup.stiffness', 'Stiffness, right');
    add('left', 'warmup.stiffness', 'Stiffness, left');
    add('right', 'tam.total', 'Whole-hand range, right');
    add('left', 'tam.total', 'Whole-hand range, left');
  }
  if (!rows.length) {
    stage.board.draw(drawMessage('No measurements yet', ['Complete a session in this programme to start your history.']));
    stage.board.show();
    await flow.wait(4);
    stage.board.hide();
    return;
  }
  stage.card.hide();
  if (records.length < 2) {
    // one session has no trend to draw yet
    stage.board.draw(
      drawMessage('Day one is saved', [
        'Tomorrow the same Hand Print shows your first change.',
        'A change is marked only when it is bigger than its margin of error.',
      ]),
    );
    stage.board.show();
    void sound.say('progress-first');
    await flow.wait(6);
    stage.board.hide();
    return;
  }
  const simulated = records.some((r) => r.simulated);
  const title = `Progress over ${records.length} session${records.length === 1 ? '' : 's'}${simulated && !state.film ? ' (simulated history)' : ''}`;
  const ghost = program === 'understudy' ? showGhost(records, us) : null;
  const note = ghost ? 'On the mat: an earlier closed hand, in blue, and the latest pose.' : 'Margin estimated from simulation and your repeated measurements.';
  stage.board.draw(drawProgress(rows.slice(0, 4), title, note), 1.4);
  stage.board.show();
  void sound.say('progress-intro');
  const hideGhost = ghost ? flow.addCleanup(ghost) : () => {};
  try {
    if (options.hold) await flow.until(() => false);
    else await flow.wait(ghost ? 9 : 7);
  } finally {
    hideGhost();
    stage.board.hide();
  }
}

/**
 * The latest recorded fist beside a ghost of the same hand two weeks ago. Both
 * stand thumb up in the middle of the mat, fingers pointing away, so the curl
 * of each finger reads from the seat and the forearms run back between the
 * resting hands. Returns a function that hides them.
 */
function showGhost(records: SessionRecord[], hand: Handedness): (() => void) | null {
  const withPose = records.filter((r) => r.poses?.[hand]?.fist);
  if (withPose.length < 2) return null;
  const today = withPose[withPose.length - 1].poses![hand]!.fist;
  const cutoff = withPose[withPose.length - 1].startedAt - 14 * 86400000;
  const older = withPose.filter((r) => r.startedAt <= cutoff);
  const earlier = older[older.length - 1] ?? withPose[0];
  const before = earlier.poses![hand]!.fist;
  const s = hand === 'left' ? 1 : -1;
  const f = state.station.forward;
  const r = state.station.right;
  // WebXR joint frames: -Z along the bones, +Y out of the back of the hand;
  // thumb up with the fingers ahead puts the palm toward the midline
  const Z = new Vector3(-f[0], 0, -f[2]);
  const Y = new Vector3(-s * r[0], 0, -s * r[2]);
  const X = new Vector3().crossVectors(Y, Z);
  const basis = new Matrix4().makeBasis(X, Y, Z);
  const inv = new Matrix4();
  const m = new Matrix4();
  const place = (src: number[], u: number): Float32Array => {
    const display = basis.clone().setPosition(stage.toWorld(u, -0.1, 0.035));
    inv.fromArray(src, 0).invert();
    const out = new Float32Array(src.length);
    for (let j = 0; j < 25; j++) {
      m.fromArray(src, j * 16).premultiply(inv).premultiply(display);
      m.toArray(out, j * 16);
    }
    return out;
  };
  const ghostModel = stage.hands.history;
  const todayModel = hand === 'left' ? stage.hands.demoLeft : stage.hands.demoRight;
  ghostModel.setMaterial(stage.historyGhost);
  ghostModel.apply(place(before, -0.075));
  ghostModel.setVisible(true);
  todayModel.setMaterial(stage.skin);
  todayModel.apply(place(today, 0.03));
  todayModel.setVisible(true);
  // name the two hands on the mat, past the fingertips, so neither is taken for a tracked hand
  stage.mat.labels = [
    { u: -0.03, v: 0.13, text: 'Earlier', color: PALETTE.understudy, align: 'right' },
    { u: 0.005, v: 0.13, text: 'Latest', color: PALETTE.ink, align: 'left' },
  ];
  stage.mat.markDirty();
  return () => {
    ghostModel.setVisible(false);
    todayModel.setVisible(false);
    stage.mat.labels = [];
    stage.mat.markDirty();
  };
}
