/**
 * Progress: the metrics that matter for the programme, each against its
 * usual range, with only real changes (bigger than the MDC) marked.
 */
import { Handedness } from '../../core/joints.js';
import { MetricId } from '../../core/measure.js';
import { progressFor, seriesFor, metricKey, SessionRecord } from '../../core/records.js';
import { sound } from '../audio.js';
import { stage } from '../stage.js';
import { state, understudyHand } from '../state.js';
import { store } from '../store.js';
import { drawProgress, ProgressRow } from '../ui/viz.js';
import { flow } from './engine.js';

export async function showProgress(): Promise<void> {
  flow.step = 'progress';
  const records = (await store.sessions()).filter((r) => r.completed);
  const program = state.profile.program;
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
  } else {
    add('right', 'warmup.stiffness', 'Stiffness, right');
    add('left', 'warmup.stiffness', 'Stiffness, left');
    add('right', 'tam.total', 'Whole-hand range, right');
    add('left', 'tam.total', 'Whole-hand range, left');
  }
  if (!rows.length) return;
  stage.card.hide();
  const simulated = records.some((r) => r.simulated);
  const title = `Progress over ${records.length} session${records.length === 1 ? '' : 's'}${simulated ? ' (simulated history)' : ''}`;
  stage.board.draw(drawProgress(rows.slice(0, 4), title), 1.4);
  stage.board.show();
  void sound.say('progress-intro');
  const ghost = program === 'understudy' ? showGhost(records, us) : null;
  await flow.wait(ghost ? 9 : 7);
  ghost?.();
  stage.board.hide();
}

/**
 * Today's fullest fist beside a ghost of the same hand two weeks ago, both
 * resting on the mat centre. Returns a function that hides them.
 */
function showGhost(records: SessionRecord[], hand: Handedness): (() => void) | null {
  const withPose = records.filter((r) => r.poses?.[hand]?.fist);
  if (withPose.length < 2) return null;
  const today = withPose[withPose.length - 1].poses![hand]!.fist;
  const before = withPose[Math.max(0, withPose.length - 15)].poses![hand]!.fist;
  const place = (src: number[], u: number): Float32Array => {
    const p = new Float32Array(src);
    const target = stage.toWorld(u, -0.02, 0.07);
    const dx = target.x - p[12];
    const dy = target.y - p[13];
    const dz = target.z - p[14];
    for (let j = 0; j < 25; j++) {
      p[j * 16 + 12] += dx;
      p[j * 16 + 13] += dy;
      p[j * 16 + 14] += dz;
    }
    return p;
  };
  const ghostModel = stage.hands.history;
  const todayModel = hand === 'left' ? stage.hands.demoLeft : stage.hands.demoRight;
  ghostModel.apply(place(before, -0.05));
  ghostModel.setVisible(true);
  todayModel.setMaterial(stage.skin);
  todayModel.apply(place(today, 0.07));
  todayModel.setVisible(true);
  return () => {
    ghostModel.setVisible(false);
    todayModel.setVisible(false);
  };
}
