import { describe, expect, it } from 'vitest';
import { assistanceForSession } from '../src/core/assistance.js';
import type { Handedness } from '../src/core/joints.js';
import {
  EXERCISE_LABEL,
  ExerciseId,
  explainAssistance,
  gmiFromRecords,
  nextStepHints,
  planRoutine,
  programmeHints,
  visitDays,
} from '../src/core/coach.js';
import type { MetricId } from '../src/core/measure.js';
import { metricKey, MetricValue, ProgramId, SessionRecord } from '../src/core/records.js';

const at = (day: number, hour = 9) => new Date(2026, 9, day, hour, 0).getTime();

function metric(value: number): MetricValue {
  return { value, trials: [value - 1, value, value + 1], validShare: 1 };
}

interface VisitOpts {
  left?: Partial<Record<MetricId, number>>;
  right?: Partial<Record<MetricId, number>>;
  completed?: boolean;
  exercises?: SessionRecord['exercises'];
  program?: ProgramId;
  understudy?: Handedness | null;
}

function visit(day: number, o: VisitOpts = {}, hour = 9): SessionRecord {
  const metrics: SessionRecord['metrics'] = {};
  for (const [hand, values] of [['left', o.left], ['right', o.right]] as const) {
    for (const id of Object.keys(values ?? {}) as MetricId[]) {
      metrics[metricKey(hand, id)] = metric(values![id] as number);
    }
  }
  return {
    id: `v${day}-${hour}`,
    startedAt: at(day, hour),
    program: o.program ?? 'understudy',
    understudy: o.understudy === undefined ? 'left' : o.understudy,
    appVersion: '1.0.0',
    calibrationHash: 'fixture',
    metrics,
    exercises: o.exercises ?? [],
    completed: o.completed ?? true,
  };
}

/** Every planner ratio at 1.0 (the Understudy hand matches the Lead). */
const EVEN = { individuation: 90, kapandji: 8, 'tap.amplitude': 1.2, opening: 85, spread: 30 };

/** Five completed visits in which the Understudy hand's finger independence is 40% of the Lead's. */
const FIVE_LAG = [1, 2, 3, 4, 5].map((d) =>
  visit(d, { left: { ...EVEN, individuation: 40 }, right: { ...EVEN, individuation: 100 } }),
);

/** Five completed visits with no lagging movement. */
const FIVE_EVEN = [1, 2, 3, 4, 5].map((d) => visit(d, { left: EVEN, right: EVEN }));

/** Tam ranges for the four fingers, with the Lead's ranges held fixed. */
function tamVisit(day: number, index: number, lead = 120, hour = 9): SessionRecord {
  return visit(day, { left: { 'tam.index': index }, right: { 'tam.index': lead } }, hour);
}

describe('planRoutine', () => {
  it('returns the four measured exercises with a baseline reason before three completed understudy visits', () => {
    for (const history of [[], [visit(1)], [visit(1), visit(2)], [visit(1), visit(2), visit(3, { completed: false })]]) {
      const plan = planRoutine(history, 'left');
      expect(plan.exercises).toEqual(['flower', 'piano', 'thumb', 'tap']);
      expect(plan.reasons).toHaveLength(1);
      expect(plan.reasons[0]).toMatch(/baseline/);
    }
    expect(planRoutine([], 'left').reasons[0]).toBe('Visit 1 of 3 builds your baseline: the four measured exercises.');
    expect(planRoutine([visit(1), visit(2)], 'left').reasons[0]).toBe('Visit 3 of 3 builds your baseline: the four measured exercises.');
  });

  it('ignores other programmes and the other hand when counting the baseline', () => {
    const other = [visit(1, { understudy: 'right' }), visit(2, { understudy: 'right' }), visit(3, { program: 'warmup' })];
    expect(planRoutine(other, 'left').reasons[0]).toMatch(/Visit 1 of 3/);
  });

  it('puts finger independence second when the Understudy hand is at 40% of the Lead', () => {
    const plan = planRoutine(FIVE_LAG, 'left');
    expect(plan.exercises[0]).toBe('flower');
    expect(plan.exercises[1]).toBe('piano');
    expect(plan.reasons.some((r) => r.includes('finger independence'))).toBe(true);
    expect(plan.reasons).toContain('Focus: finger independence, at 40% of your Lead hand.');
  });

  it('starts with the flower, has no duplicates and has four exercises by default', () => {
    for (const history of [FIVE_LAG, FIVE_EVEN]) {
      const { exercises } = planRoutine(history, 'left');
      expect(exercises[0]).toBe('flower');
      expect(exercises).toHaveLength(4);
      expect(new Set(exercises).size).toBe(exercises.length);
    }
  });

  it('gives the requested routine length for sizes 2 to 6', () => {
    for (const size of [2, 3, 4, 5, 6]) {
      for (const history of [FIVE_LAG, FIVE_EVEN]) {
        const { exercises } = planRoutine(history, 'left', size);
        expect(exercises).toHaveLength(size);
        expect(new Set(exercises).size).toBe(size);
      }
    }
  });

  it('makes the plan one exercise shorter and says so after a session stopped early', () => {
    const history = [...FIVE_LAG, visit(6, { completed: false, left: EVEN, right: EVEN })];
    const plan = planRoutine(history, 'left');
    expect(plan.exercises).toHaveLength(3);
    expect(plan.exercises[0]).toBe('flower');
    expect(plan.exercises[1]).toBe('piano');
    expect(plan.reasons).toContain('Last session stopped early, so today is one exercise shorter.');
    expect(new Set(plan.exercises).size).toBe(3);
  });

  it('brings never-done exercises before recently done ones, longest-ago first', () => {
    // piano is never done; tap was done at visit 1 (4 sessions ago); dial at visit 3 (2 ago);
    // stones at visit 4 (1 ago); thumb, spread and wave at visit 5 (0 ago).
    const history = [
      visit(1, { left: EVEN, right: EVEN, exercises: [{ id: 'tap', seconds: 60, reps: 8 }] }),
      visit(2, { left: EVEN, right: EVEN }),
      visit(3, { left: EVEN, right: EVEN, exercises: [{ id: 'dial', seconds: 60, reps: 8 }] }),
      visit(4, { left: EVEN, right: EVEN, exercises: [{ id: 'stones', seconds: 60, reps: 8 }] }),
      visit(5, {
        left: EVEN,
        right: EVEN,
        exercises: [
          { id: 'thumb', seconds: 60, reps: 8 },
          { id: 'spread', seconds: 60, reps: 8 },
          { id: 'wave', seconds: 60, reps: 8 },
        ],
      }),
    ];
    expect(planRoutine(history, 'left').exercises).toEqual(['flower', 'piano', 'tap', 'dial']);
  });

  it('treats an exercise logged with zero reps as never done', () => {
    // piano was logged at the latest visit but with no reps, so it still counts as never done
    const history = [
      visit(1, { left: EVEN, right: EVEN }),
      visit(2, { left: EVEN, right: EVEN }),
      visit(3, { left: EVEN, right: EVEN, exercises: [{ id: 'piano', seconds: 60, reps: 0 }] }),
    ];
    expect(planRoutine(history, 'left').exercises).toEqual(['flower', 'piano', 'thumb', 'tap']);
  });

  it('is deterministic: the same history gives the same plan and the history is not changed', () => {
    const history = [...FIVE_LAG, visit(6, { left: EVEN, right: EVEN, exercises: [{ id: 'thumb', seconds: 30, reps: 4 }] })];
    const before = structuredClone(history);
    const first = planRoutine(history, 'left');
    expect(planRoutine(history, 'left')).toEqual(first);
    expect(planRoutine(structuredClone(history), 'left')).toEqual(first);
    expect(history).toEqual(before);
  });

  // Suspected bug: planRoutine pushes the weakest exercise before it checks the
  // routine length, so size 1 (which should be the flower alone) returns the
  // flower plus the weakest exercise. Minor: the default size is 4.
  it('returns only the flower for size 1', () => {
    expect(planRoutine(FIVE_LAG, 'left', 1).exercises).toEqual(['flower']);
  });
});

describe('explainAssistance', () => {
  it('says "first reading" for a finger with no earlier history', () => {
    const today = visit(10, { left: { 'tam.index': 80, 'tam.middle': 80, 'tam.ring': 80, 'tam.little': 80 }, right: { 'tam.index': 120, 'tam.middle': 120, 'tam.ring': 120, 'tam.little': 120 } });
    const lines = explainAssistance([], today, 'left');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Index: first reading 80°, starts at 60%\.$/);
    for (const line of lines) expect(line).toContain('first reading');
  });

  it('shows a share change beyond the margin, from one value to another, with the range movement', () => {
    const before = [tamVisit(1, 40)];
    const today = tamVisit(2, 120);
    const line = explainAssistance(before, today, 'left')[0];
    expect(line).toContain(' to ');
    expect(line).toContain('more than its');
    expect(line).toMatch(/^Index: 20% to 60%\. Rose 40°, more than its \d+° margin\.$/);
  });

  it('says a tiny change is within the margin and keeps the share', () => {
    const before = [tamVisit(1, 80)];
    const today = tamVisit(2, 81);
    const line = explainAssistance(before, today, 'left')[0];
    expect(line).toContain('within its');
    expect(line).toMatch(/^Index: stays 60%\. 1° is within its \d+° margin\.$/);
  });

  it('the assistance holds a finger with no reading today at 0% (Watch)', () => {
    // The assistance decision holds a finger with no reading today at 0% (Watch).
    const before = [tamVisit(1, 120, 240), tamVisit(2, 122, 240)];
    const today = visit(3, { left: { 'tam.index': NaN, 'tam.middle': 124, 'tam.ring': 124, 'tam.little': 124 }, right: { 'tam.index': 240, 'tam.middle': 240, 'tam.ring': 240, 'tam.little': 240 } });
    expect(assistanceForSession(before, today, 'left')[1].share).toBe(0);
  });

  // Suspected bug: explainAssistance replays a NaN reading as "nothing changed",
  // so the Index line keeps the share it had from the earlier visits (45% here,
  // Lead at 240) and reads "stays at 45%". assistanceForSession, which sets the
  // rendered share, gives 0% (Watch) for the same finger and day, so the two views
  // disagree.
  it('says Watch for a finger with no reading today, as the assistance does', () => {
    const before = [tamVisit(1, 120, 240), tamVisit(2, 122, 240)];
    const today = visit(3, { left: { 'tam.index': NaN, 'tam.middle': 124, 'tam.ring': 124, 'tam.little': 124 }, right: { 'tam.index': 240, 'tam.middle': 240, 'tam.ring': 240, 'tam.little': 240 } });
    expect(explainAssistance(before, today, 'left')[0]).toContain('no reading today');
  });
});

describe('nextStepHints', () => {
  it('gives the next step for a finger with history, beside today\'s range', () => {
    const records = [tamVisit(1, 40), tamVisit(2, 41), tamVisit(3, 42)];
    const hints = nextStepHints(records, 'left');
    expect(hints[0]).toMatch(/^Index: next step at \d+° \(now 41°\)\.$/);
    expect(hints[0]).toContain('next step at');
  });

  it('says a finger with no data is measured again next visit', () => {
    const hints = nextStepHints([], 'left');
    expect(hints).toHaveLength(4);
    for (const hint of hints) expect(hint).toContain('measured again');
    expect(nextStepHints([visit(1, { left: { 'tam.index': NaN } })], 'left')[0]).toBe('Index: measured again next visit.');
  });

  it('says a finger that already moves on its own is in Perform', () => {
    const records = [tamVisit(1, 130), tamVisit(2, 130)];
    expect(nextStepHints(records, 'left')[0]).toBe('Index: already moves on its own.');
  });
});

describe('visitDays', () => {
  const now = at(15, 9);

  it('has 14 entries by default, with today last', () => {
    const days = visitDays([visit(15)], now);
    expect(days).toHaveLength(14);
    expect(days[13]).toBe(true);
    expect(days.slice(0, 13).every((d) => d === false)).toBe(true);
  });

  it('does not count an incomplete session', () => {
    expect(visitDays([visit(15, { completed: false })], now).every((d) => d === false)).toBe(true);
  });

  it('marks the day 3 days ago at index 10', () => {
    const days = visitDays([visit(12)], now);
    expect(days[10]).toBe(true);
    expect(days.filter(Boolean)).toHaveLength(1);
  });

  it('counts day 13 ago at index 0 and leaves day 14 ago out of the window', () => {
    expect(visitDays([visit(2)], now)[0]).toBe(true);
    expect(visitDays([visit(1)], now).every((d) => d === false)).toBe(true);
  });
});

describe('programmeHints', () => {
  it('returns one string for the phantom programme', () => {
    const hints = programmeHints([], 'phantom', null);
    expect(hints).toHaveLength(1);
    expect(typeof hints[0]).toBe('string');
    expect(hints[0]).toBe('First session.');
    const oneVisit = programmeHints([visit(1, { program: 'phantom', understudy: null })], 'phantom', null);
    expect(oneVisit).toHaveLength(1);
    expect(oneVisit[0]).toMatch(/more session/);
  });

  it('asks for two more visits when the warm-up has no usable measurements', () => {
    expect(programmeHints([], 'warmup', null)).toEqual(['Two more visits give each measurement its usual range.']);
  });
});

describe('gmiFromRecords and labels', () => {
  it('maps phantom records with the default stage and pain', () => {
    const [mapped] = gmiFromRecords([visit(1, { program: 'phantom', understudy: null })]);
    expect(mapped).toEqual({ stage: 'recognise', painBefore: 0, painAfter: 0, laterality: undefined, completed: true });
  });

  it('has a label for every exercise id', () => {
    const ids: ExerciseId[] = ['flower', 'piano', 'thumb', 'tap', 'stones', 'dial', 'spread', 'wave'];
    for (const id of ids) expect(EXERCISE_LABEL[id].length).toBeGreaterThan(0);
    expect(EXERCISE_LABEL.piano).toBe('Table piano');
  });
});
