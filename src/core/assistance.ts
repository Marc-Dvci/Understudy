import { Handedness, otherHand } from './joints.js';
import { MetricId } from './measure.js';
import { fiveShares, metricKey, SessionRecord, sharesFromHistory } from './records.js';
import { FingerControl, gainFromRange } from './rehearse.js';

const FINGERS: MetricId[] = ['tam.index', 'tam.middle', 'tam.ring', 'tam.little'];

/** The same measured assistance decision for a live visit and a prepared preview. */
export function assistanceForSession(history: SessionRecord[], current: SessionRecord, hand: Handedness): FingerControl[] {
  const all = [...history.filter((record) => record.id !== current.id), current];
  const measured = sharesFromHistory(all, hand);
  const own = FINGERS.map((id) => current.metrics[metricKey(hand, id)]?.value ?? NaN);
  const ref = FINGERS.map((id) => current.metrics[metricKey(otherHand(hand), id)]?.value ?? NaN);
  const shares = fiveShares(measured.map((share, f) => Number.isFinite(own[f]) ? share : 0));
  return shares.map((share, f) => ({ share, gain: gainFromRange(own[Math.max(0, f - 1)], ref[Math.max(0, f - 1)], share), gate: 1 }));
}
