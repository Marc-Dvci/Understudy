import { describe, expect, it } from 'vitest';
import { careSummaryHtml } from '../src/core/report.js';
import { defaultProfile, metricKey, Profile, SessionRecord } from '../src/core/records.js';

const GENERATED = Date.UTC(2026, 9, 15);

function understudyRecord(i: number, index: number, extra: Partial<SessionRecord> = {}): SessionRecord {
  const metrics: SessionRecord['metrics'] = {};
  const fingers = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as const;
  fingers.forEach((id, f) => {
    const v = index + 10 * f;
    metrics[metricKey('left', id)] = { value: v, trials: [v - 2, v, v + 2], validShare: 1 };
  });
  return {
    id: `s${i}`,
    startedAt: Date.UTC(2026, 9, 1 + i),
    program: 'understudy',
    understudy: 'left',
    appVersion: 'test',
    calibrationHash: 'fixture',
    metrics,
    exercises: [],
    completed: true,
    ...extra,
  };
}

function fiveUnderstudy(): SessionRecord[] {
  return [60, 70, 80, 90, 100].map((v, i) => understudyRecord(i, v));
}

describe('care summary page', () => {
  it('is a standalone document with no script', () => {
    const html = careSummaryHtml(fiveUnderstudy(), defaultProfile(), { generatedAt: GENERATED });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<title>Understudy: session summary</title>');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('says so when there are no completed sessions', () => {
    const html = careSummaryHtml([], defaultProfile(), { generatedAt: GENERATED });
    expect(html).toContain('No completed sessions yet.');
    expect(html).not.toContain('<svg');
    expect(html).toContain('2026-10-15');
  });

  it('shows the simulated notice when an included record is simulated', () => {
    const records = [understudyRecord(0, 60, { simulated: true }), understudyRecord(1, 70)];
    const html = careSummaryHtml(records, defaultProfile(), { generatedAt: GENERATED });
    expect(html).toContain('Contains simulated sample sessions. These are not a person\'s measurements.');
    const clean = careSummaryHtml(fiveUnderstudy(), defaultProfile(), { generatedAt: GENERATED });
    expect(clean).not.toContain('Contains simulated sample sessions');
  });

  it('lists the understudy metrics with a sparkline per row', () => {
    const html = careSummaryHtml(fiveUnderstudy(), defaultProfile(), { generatedAt: GENERATED });
    expect(html).toContain('Index finger range');
    expect(html).toContain('<svg');
    expect(html).toContain('2026-10-01 to 2026-10-05');
    expect(html).toContain('Assistance per finger today');
    expect(html).toContain("Assistance changes only when a finger's measured range moves more than its margin of error.");
  });

  it('never prints NaN or undefined, even when some values are missing', () => {
    const records = [0, 1, 2, 3, 4].map((i) => {
      const r = understudyRecord(i, 60 + i * 5);
      if (i % 2 === 1) {
        r.metrics[metricKey('left', 'tam.index')] = { value: NaN, trials: [NaN, NaN], validShare: 0 };
      }
      if (i === 4) {
        r.metrics[metricKey('left', 'tam.little')] = { value: NaN, trials: [], validShare: 0 };
      }
      return r;
    });
    const html = careSummaryHtml(records, defaultProfile(), { generatedAt: GENERATED });
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).toContain('—');
  });

  it('escapes markup from record ids and from the programme id', () => {
    const records = [understudyRecord(0, 60, { id: '<script>alert(1)</script>' })];
    const html = careSummaryHtml(records, defaultProfile(), { generatedAt: GENERATED });
    expect(html).not.toContain('<script');

    const odd = '<script>alert(1)</script>' as Profile['program'];
    const profile: Profile = { ...defaultProfile(), program: odd };
    const oddRecords = [{ ...understudyRecord(0, 60), program: odd }];
    const escaped = careSummaryHtml(oddRecords, profile, { generatedAt: GENERATED });
    expect(escaped).not.toContain('<script');
    expect(escaped).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows left and right rows for desk break with both hands', () => {
    const deskbreak = 'deskbreak' as Profile['program'];
    const records = [0, 1, 2].map((i) => {
      const metrics: SessionRecord['metrics'] = {};
      for (const hand of ['left', 'right'] as const) {
        metrics[metricKey(hand, 'tam.total')] = { value: 200 + i, trials: [199 + i, 200 + i, 201 + i], validShare: 1 };
        metrics[metricKey(hand, 'spread')] = { value: 30, trials: [30], validShare: 1 };
        metrics[metricKey(hand, 'opening')] = { value: 80, trials: [80], validShare: 1 };
      }
      return { ...understudyRecord(i, 60, { metrics, understudy: null }), program: deskbreak };
    });
    const profile: Profile = { ...defaultProfile(), program: deskbreak, understudy: null };
    const html = careSummaryHtml(records, profile, { generatedAt: GENERATED });
    expect(html).toContain('Desk break');
    expect(html).toContain('Whole-hand range (left)');
    expect(html).toContain('Whole-hand range (right)');
    expect(html).toContain('(left)');
    expect(html).toContain('(right)');
    expect(html).not.toContain('Assistance per finger today');
  });

  it('pain table lists the most recent sessions for phantom', () => {
    const phantom: Profile = { ...defaultProfile(), program: 'phantom' };
    const records = [0, 1, 2].map((i) => {
      const r = understudyRecord(i, 60, { program: 'phantom', painBefore: 5 + i, painAfter: 3 + i });
      r.metrics = { [metricKey('left', 'pain')]: { value: 3 + i, trials: [3 + i], validShare: 1 } };
      return r;
    });
    const html = careSummaryHtml(records, phantom, { generatedAt: GENERATED });
    expect(html).toContain('Pain in the last 3 sessions');
    expect(html).toContain('2026-10-03');
    expect(html).toContain('Pain before');
    expect(html).not.toContain('Index finger');
    expect(html).not.toContain('Assistance per finger today');
  });
});
