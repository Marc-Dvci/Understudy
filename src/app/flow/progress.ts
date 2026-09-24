/**
 * Progress: the metrics that matter for the programme, each against its
 * usual range, with only real changes (bigger than the MDC) marked.
 */
import { Handedness } from '../../core/joints.js';
import { MetricId } from '../../core/measure.js';
import { progressFor, seriesFor, metricKey } from '../../core/records.js';
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
  stage.board.draw(drawProgress(rows.slice(0, 4), `Progress over ${records.length} session${records.length === 1 ? '' : 's'}`), 1.4);
  stage.board.show();
  void sound.say('progress-intro');
  await flow.wait(7);
  stage.board.hide();
}
