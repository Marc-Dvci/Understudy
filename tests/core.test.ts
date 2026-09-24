import { describe, expect, it } from 'vitest';
import { computeDrift, driftSentence } from '../src/core/embodiment.js';
import { GmiSession, lateralityBlock, nextGmiStage, scoreLaterality } from '../src/core/gmi.js';
import { analyseTapping, fitWarmup, individuation, timeToFist } from '../src/core/measure.js';
import { metricKey, progressFor, SessionRecord, sharesFromHistory, toCsv } from '../src/core/records.js';
import { belowUsualTwice, classifyChange, estimateError, mdc95, semFromSeries, spearman, usualRange } from '../src/core/stats.js';

describe('stats', () => {
  it('MDC95 is 1.96 x sqrt(2) x SEM', () => {
    expect(mdc95(10)).toBeCloseTo(27.72, 2);
  });
  it('the successive-difference SEM ignores a slow trend', () => {
    const trend = Array.from({ length: 20 }, (_, i) => 100 + i * 2);
    expect(semFromSeries(trend)).toBeCloseTo(Math.SQRT2, 5);
  });
  it('uses the prior until five sessions, never less than half the prior after', () => {
    expect(estimateError([], [1, 2, 3], 8).source).toBe('prior');
    const e = estimateError([[100, 100, 100]], [100, 100, 100, 100, 100], 8);
    expect(e.source).toBe('personal');
    expect(e.sem).toBe(4);
  });
  it('classifies change only beyond the MDC', () => {
    expect(classifyChange(110, 100, 12, true)).toBe('steady');
    expect(classifyChange(115, 100, 12, true)).toBe('improved');
    expect(classifyChange(85, 100, 12, true)).toBe('declined');
    expect(classifyChange(85, 100, 12, false)).toBe('improved');
  });
  it('flags two consecutive sessions below the usual range', () => {
    const v = [200, 202, 198, 201, 199, 200, 170, 168];
    expect(belowUsualTwice(v, 5, true)).toBe(true);
    expect(belowUsualTwice([...v.slice(0, 7), 199], 5, true)).toBe(false);
    expect(usualRange(v.slice(0, 6), 5)!.center).toBe(200);
  });
  it('Spearman handles ties and perfect order', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });
});

describe('measurement analyses', () => {
  it('counts taps and measures a fading amplitude', () => {
    const t: number[] = [];
    const g: number[] = [];
    for (let i = 0; i < 720; i++) {
      const time = i / 72;
      t.push(time);
      const amp = 0.07 - time * 0.003;
      g.push(0.01 + (amp - 0.01) * (0.5 - 0.5 * Math.cos(2 * Math.PI * 2 * time)));
    }
    const r = analyseTapping(t, g);
    expect(r.taps).toBeGreaterThanOrEqual(18);
    expect(r.rate).toBeGreaterThan(1.8);
    expect(r.decrement).toBeGreaterThan(0);
  });
  it('time to fist is the 90% crossing', () => {
    const t = Array.from({ length: 100 }, (_, i) => i / 50);
    const f = t.map((x) => (x < 0.3 ? 30 : 30 + 200 * (1 - Math.exp(-(x - 0.3) / 0.2))));
    const ttf = timeToFist(t, f);
    expect(ttf).toBeGreaterThan(0.7);
    expect(ttf).toBeLessThan(0.85);
  });
  it('the warm-up fit recovers plateau, first repetition and stiffness', () => {
    const ranges = Array.from({ length: 10 }, (_, r) => 600 * (1 - 0.3 * Math.exp(-r / 2)));
    const fit = fitWarmup(ranges)!;
    expect(fit.plateau).toBeCloseTo(600, 0);
    expect(fit.stiffness).toBeCloseTo(30, 0);
  });
  it('individuation is 100% for a finger that moves alone', () => {
    expect(individuation(0, [20, 20, 20, 20], [80, 20, 20, 20])).toBe(100);
    expect(individuation(0, [20, 20, 20, 20], [80, 80, 80, 80])).toBe(0);
  });
});

describe('embodiment drift', () => {
  it('measures movement of the felt position toward the virtual hand', () => {
    const d = computeDrift({ x: 0, z: 0 }, { x: 0.12, z: 0 }, [{ x: 0.01, z: 0 }, { x: -0.01, z: 0 }], [{ x: 0.04, z: 0 }, { x: 0.03, z: 0.01 }]);
    expect(d.driftCm).toBeCloseTo(3.5, 5);
    expect(driftSentence(d)).toContain('toward');
  });
});

describe('graded motor imagery', () => {
  it('builds balanced laterality blocks', () => {
    const b = lateralityBlock(1, 20);
    expect(b.filter((s) => s.hand === 'left').length).toBe(10);
  });
  it('scores accuracy and side asymmetry', () => {
    const b = lateralityBlock(2, 10);
    const s = scoreLaterality(b.map((st) => ({ stimulus: st, answer: st.hand, rt: st.hand === 'left' ? 1.2 : 1.0 })));
    expect(s.accuracy).toBe(1);
    expect(s.asymmetry).toBeCloseTo(0.2 / 1.1, 5);
  });
  it('advances after three good sessions and steps back on rising pain', () => {
    const lat = { accuracy: 0.9, accuracyLeft: 0.9, accuracyRight: 0.9, rtLeft: 1, rtRight: 1.05, asymmetry: 0.05, n: 20 };
    const good: GmiSession = { stage: 'recognise', painBefore: 4, painAfter: 4, laterality: lat, completed: true };
    expect(nextGmiStage([good, good]).change).toBe('stay');
    expect(nextGmiStage([good, good, good]).stage).toBe('imagine');
    const sore: GmiSession = { stage: 'imagine', painBefore: 3, painAfter: 6, completed: true };
    const back = nextGmiStage([good, good, good, sore, sore]);
    expect(back.change).toBe('step-back');
    expect(back.stage).toBe('recognise');
  });
});

function record(i: number, own: number[], lead: number[]): SessionRecord {
  const metrics: SessionRecord['metrics'] = {};
  const ids = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as const;
  ids.forEach((id, f) => {
    metrics[metricKey('left', id)] = { value: own[f], trials: [own[f] - 2, own[f], own[f] + 2], validShare: 1 };
    metrics[metricKey('right', id)] = { value: lead[f], trials: [lead[f]], validShare: 1 };
  });
  return {
    id: `s${i}`,
    startedAt: i * 86400000,
    program: 'understudy',
    understudy: 'left',
    appVersion: 'test',
    calibrationHash: 'x',
    metrics,
    exercises: [],
    completed: true,
  };
}

describe('records', () => {
  it('replays the hand-over from history: share rises with real recovery', () => {
    const lead = [240, 250, 240, 220];
    const early = Array.from({ length: 6 }, (_, i) => record(i, [60, 60, 60, 60], lead));
    const later = Array.from({ length: 6 }, (_, i) => record(6 + i, [140, 140, 140, 140], lead));
    const s0 = sharesFromHistory(early, 'left');
    const s1 = sharesFromHistory([...early, ...later], 'left');
    expect(s1[0]).toBeGreaterThan(s0[0] + 0.25);
  });
  it('reports progress against the baseline with the MDC', () => {
    const lead = [240, 250, 240, 220];
    const hist = Array.from({ length: 8 }, (_, i) => record(i, [60 + i * 10, 60, 60, 60], lead));
    const p = progressFor(hist, 'left', 'tam.index');
    expect(p.change).toBe('improved');
    expect(p.sessions).toBe(8);
  });
  it('exports every metric to CSV', () => {
    const csv = toCsv([record(0, [60, 61, 62, 63], [240, 241, 242, 243])]);
    expect(csv.split('\n')[0]).toContain('left:tam.index');
    expect(csv.split('\n')[1]).toContain('60.00');
  });
});
