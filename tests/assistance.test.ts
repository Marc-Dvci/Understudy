import { describe, expect, it } from 'vitest';
import { assistanceForSession } from '../src/core/assistance.js';
import { metricKey, SessionRecord, sharesFromHistory, fiveShares } from '../src/core/records.js';
import { showcaseChapter } from '../src/app/emulation/showcase-options.js';

function record(day: number, range: number): SessionRecord {
  const metrics: SessionRecord['metrics'] = {};
  for (const id of ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as const) {
    metrics[metricKey('left', id)] = { value: range, trials: [range - 1, range, range + 1], validShare: 1 };
    metrics[metricKey('right', id)] = { value: 240, trials: [239, 240, 241], validShare: 1 };
  }
  return { id: String(day), startedAt: day, program: 'understudy', understudy: 'left', appVersion: '1', calibrationHash: 'fixture', metrics, exercises: [], completed: true };
}

describe('shared assistance decision', () => {
  it('uses the same history replay once when the current record is already present, without changing records', () => {
    const history = [record(1, 80), record(2, 81), record(3, 120)];
    const original = structuredClone(history);
    const expected = fiveShares(sharesFromHistory(history, 'left'));
    const controls = assistanceForSession(history, history[2], 'left');
    expect(controls.map((control) => control.share)).toEqual(expected);
    expect(assistanceForSession(history.slice(0, -1), history[2], 'left')).toEqual(controls);
    expect(history).toEqual(original);
    expect(controls.every((control) => control.gain >= 1 && control.gain <= 2)).toBe(true);
  });

  it('keeps a currently unavailable finger in Watch even when earlier history gave it a share', () => {
    const history = [record(1, 120), record(2, 122)];
    const current = record(3, 124);
    current.metrics[metricKey('left', 'tam.index')].value = NaN;
    const controls = assistanceForSession(history, current, 'left');
    expect(controls[1].share).toBe(0);
    expect(controls[2].share).toBeGreaterThan(0);
    expect(controls[0].share).toBeCloseTo(controls.slice(1).reduce((sum, control) => sum + control.share, 0) / 4);
  });

  it('keeps render gains finite when a current Lead trial is unavailable', () => {
    const history = [record(1, 120), record(2, 122)];
    const current = record(3, 124);
    for (const id of ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as const) current.metrics[metricKey('right', id)].value = NaN;
    const controls = assistanceForSession(history, current, 'left');
    expect(controls.every((control) => Number.isFinite(control.gain) && control.gain === 1)).toBe(true);
    expect(current.metrics[metricKey('right', 'tam.index')].value).toBeNaN();
  });
});

it('never selects the prepared showcase for a native headset or an ordinary first visit', () => {
  for (const chapter of ['handover', 'progress', 'measurement', 'unexpected', '']) {
    expect(showcaseChapter(new URLSearchParams(`showcase=${chapter}`), false)).toBeNull();
  }
  expect(showcaseChapter(new URLSearchParams('fresh'), true)).toBeNull();
  expect(showcaseChapter(new URLSearchParams('showcase=progress'), true)).toBe('progress');
  expect(showcaseChapter(new URLSearchParams('showcase=unexpected'), true)).toBe('handover');
});
