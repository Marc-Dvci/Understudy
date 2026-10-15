/**
 * The coach: plans today's routine from the measurements, explains every
 * assistance decision in a sentence, and says what the next visit can change.
 * It is deterministic and runs on the saved records alone, so the same history
 * always gives the same plan and every sentence can be traced to a number.
 */
import { GmiSession, GmiStage, nextGmiStage } from './gmi.js';
import { Handedness, otherHand } from './joints.js';
import { METRICS, MetricId } from './measure.js';
import {
  FingerShareState,
  historyFor,
  metricKey,
  progressFor,
  ProgramId,
  SessionRecord,
  SHARE_FINGERS,
  shareStatesFromHistory,
} from './records.js';

export type ExerciseId = 'flower' | 'piano' | 'thumb' | 'tap' | 'stones' | 'dial' | 'spread' | 'wave';

export const EXERCISE_LABEL: Record<ExerciseId, string> = {
  flower: 'Open the flower',
  piano: 'Table piano',
  thumb: 'Thumb touches',
  tap: 'Tap rhythm',
  stones: 'Stones to the bowl',
  dial: 'Turn the dial',
  spread: 'Spread and close',
  wave: 'Wave',
};

/** The movement each exercise trains, and the Hand Print metric that measures it (if one does). */
const TARGET: Record<Exclude<ExerciseId, 'flower'>, { what: string; metric: MetricId | null }> = {
  piano: { what: 'finger independence', metric: 'individuation' },
  thumb: { what: 'thumb reach', metric: 'kapandji' },
  tap: { what: 'tapping size', metric: 'tap.amplitude' },
  stones: { what: 'opening for a grasp', metric: 'opening' },
  spread: { what: 'finger spread', metric: 'spread' },
  dial: { what: 'forearm turning', metric: null },
  wave: { what: 'wrist movement', metric: null },
};

const POOL = Object.keys(TARGET) as Exclude<ExerciseId, 'flower'>[];

export interface Plan {
  exercises: ExerciseId[];
  /** One short sentence per decision, shown on the board before the routine. */
  reasons: string[];
}

const FINGER = ['Index', 'Middle', 'Ring', 'Little'];

/** The Understudy hand's latest value as a fraction of the Lead's, or NaN. */
function ratio(records: SessionRecord[], hand: Handedness, id: MetricId): number {
  const lead = otherHand(hand);
  for (let i = records.length - 1; i >= 0; i--) {
    const own = records[i].metrics[metricKey(hand, id)]?.value;
    const ref = records[i].metrics[metricKey(lead, id)]?.value;
    if (Number.isFinite(own) && Number.isFinite(ref) && (ref as number) > 0) {
      const r = (own as number) / (ref as number);
      // a lower tap fade is better; every other target is higher-is-better
      return METRICS[id].higherIsBetter ? r : 1 / r;
    }
  }
  return NaN;
}

/** Sessions since an exercise was last done (Infinity when never). */
function sinceDone(records: SessionRecord[], id: ExerciseId): number {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].exercises.some((e) => e.id === id && e.reps > 0)) return records.length - 1 - i;
  }
  return Infinity;
}

/**
 * Today's Understudy routine. The flower always opens it. The first sessions
 * use the four measured exercises to build a baseline; after that the coach
 * picks the movement that lags the Lead hand most, then the ones practised
 * least recently. A session that was stopped early makes the next one shorter.
 */
export function planRoutine(history: SessionRecord[], hand: Handedness, size = 4): Plan {
  const done = history.filter((r) => r.program === 'understudy' && r.understudy === hand);
  const completed = done.filter((r) => r.completed);
  if (completed.length < 3) {
    return {
      exercises: ['flower', 'piano', 'thumb', 'tap'],
      reasons: [`Visit ${completed.length + 1} of 3 builds your baseline: the four measured exercises.`],
    };
  }
  const reasons: string[] = [];
  const last = done[done.length - 1];
  let count = size - 1;
  if (last && !last.completed) {
    count = Math.max(1, count - 1);
    reasons.push('Last session stopped early, so today is one exercise shorter.');
  }
  const weakest = POOL
    .map((id) => ({ id, r: TARGET[id].metric ? ratio(completed, hand, TARGET[id].metric!) : NaN }))
    .filter((x) => Number.isFinite(x.r) && x.r < 0.9)
    .sort((a, b) => a.r - b.r)[0];
  const chosen: ExerciseId[] = [];
  if (weakest && count > 0) {
    chosen.push(weakest.id);
    reasons.push(`Focus: ${TARGET[weakest.id].what}, at ${Math.round(weakest.r * 100)}% of your Lead hand.`);
  }
  const rest = POOL
    .filter((id) => !chosen.includes(id))
    .map((id, order) => ({ id, since: sinceDone(completed, id), order }))
    // never done first, then longest ago; the pool order breaks ties
    .sort((a, b) => b.since - a.since || a.order - b.order);
  for (const x of rest) {
    if (chosen.length >= count) break;
    chosen.push(x.id);
  }
  const fresh = chosen.filter((id) => id !== weakest?.id && sinceDone(completed, id) === Infinity);
  if (fresh.length) reasons.push(`New today: ${fresh.map((id) => EXERCISE_LABEL[id].toLowerCase()).join(', ')}.`);
  const rotated = chosen.filter((id) => id !== weakest?.id && !fresh.includes(id));
  if (rotated.length) reasons.push(`Rotating in what you practised least recently: ${rotated.map((id) => EXERCISE_LABEL[id].toLowerCase()).join(', ')}.`);
  return { exercises: ['flower', ...chosen], reasons };
}

/** Phantom records as the graded-motor-imagery history (same mapping as the session). */
export function gmiFromRecords(history: SessionRecord[]): GmiSession[] {
  return history.map((r) => ({
    stage: (r.stage as GmiStage) ?? 'recognise',
    painBefore: r.painBefore ?? 0,
    painAfter: r.painAfter ?? 0,
    laterality: r.laterality,
    completed: r.completed,
  }));
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const deg = (x: number) => `${Math.round(x)}°`;

/**
 * One sentence per finger saying what the assistance did today and why:
 * the share moves only when the measured range moves beyond its margin.
 */
export function explainAssistance(before: SessionRecord[], today: SessionRecord, hand: Handedness): string[] {
  const prev = shareStatesFromHistory(before.filter((r) => r.id !== today.id), hand);
  const now = shareStatesFromHistory([...before.filter((r) => r.id !== today.id), today], hand);
  return now.map((s, f) => {
    // the session renders a finger with no reading today in Watch, so say so
    const own = today.metrics[metricKey(hand, SHARE_FINGERS[f])]?.value;
    if (!Number.isFinite(own)) return `${FINGER[f]}: no reading today, so Watch.`;
    return explainFinger(FINGER[f], prev[f], s);
  });
}

function explainFinger(name: string, prev: FingerShareState, now: FingerShareState): string {
  if (now.sessions === 0 || !Number.isFinite(now.current)) return `${name}: no reading today, so Watch.`;
  if (prev.sessions === 0 || !Number.isFinite(prev.anchorRange)) {
    return `${name}: first reading ${deg(now.current)}, starts at ${pct(now.share)}.`;
  }
  if (Math.abs(now.share - prev.share) > 0.005) {
    const moved = now.anchorRange - prev.anchorRange;
    return `${name}: ${pct(prev.share)} to ${pct(now.share)}. ${moved >= 0 ? 'Rose' : 'Fell'} ${deg(Math.abs(moved))}, more than its ${deg(now.mdc)} margin.`;
  }
  const diff = now.current - now.anchorRange;
  return `${name}: stays ${pct(now.share)}. ${deg(Math.abs(diff))} is within its ${deg(now.mdc)} margin.`;
}

/**
 * What the next visit can change, per finger: the range at which the share
 * takes its next step, beside today's value. Fingers already in Perform say so.
 */
export function nextStepHints(records: SessionRecord[], hand: Handedness): string[] {
  return shareStatesFromHistory(records, hand).map((s, f) => {
    if (s.sessions === 0 || !Number.isFinite(s.anchorRange)) return `${FINGER[f]}: measured again next visit.`;
    if (s.share >= 1) return `${FINGER[f]}: already moves on its own.`;
    return `${FINGER[f]}: next step at ${deg(s.anchorRange + s.mdc)} (now ${deg(s.current)}).`;
  });
}

/** Hints for the other programmes, from the same margins. */
export function programmeHints(records: SessionRecord[], program: ProgramId, understudy: Handedness | null): string[] {
  const history = historyFor(records, program, understudy);
  if (program === 'understudy') return nextStepHints(history, understudy ?? 'left');
  if (program === 'phantom') return [nextGmiStage(gmiFromRecords(history)).reason];
  const ids: [Handedness, MetricId][] = program === 'warmup'
    ? [['right', 'warmup.stiffness'], ['left', 'warmup.stiffness']]
    : [['right', 'tam.total'], ['left', 'tam.total'], ['right', 'spread'], ['left', 'spread']];
  const out: string[] = [];
  for (const [h, id] of ids) {
    const p = progressFor(history, h, id);
    if (p.sessions < 2 || !p.usual) continue;
    const unit = p.def.unit === 'deg' ? '°' : p.def.unit;
    out.push(`${p.def.label}, ${h}: usual ${Math.round(p.usual.low)}–${Math.round(p.usual.high)}${unit}; a change needs more than ${Math.round(p.error.mdc)}${unit}.`);
  }
  if (!out.length) out.push('Two more visits give each measurement its usual range.');
  return out.slice(0, 3);
}

/**
 * Which of the last `days` calendar days (local time, oldest first, today
 * last) had a completed session. No streaks: a missed day is just a gap.
 */
export function visitDays(records: SessionRecord[], now: number, days = 14): boolean[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const out = new Array<boolean>(days).fill(false);
  for (const r of records) {
    if (!r.completed) continue;
    const d = new Date(r.startedAt);
    d.setHours(0, 0, 0, 0);
    const ago = Math.round((start.getTime() - d.getTime()) / 86400000);
    if (ago >= 0 && ago < days) out[days - 1 - ago] = true;
  }
  return out;
}
