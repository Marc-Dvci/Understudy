/**
 * Demo history. The browser demo can start from weeks of earlier sessions so
 * that progress, the per-finger share and the ghost hand have something to
 * show. The sessions come from the validation simulation (synthetic patient,
 * tracker error model, the app's own measurement code) and every one is
 * marked `simulated`, which the progress board states on screen.
 */
import { Handedness, newPose } from '../../core/joints.js';
import { metricKey, newSessionId, APP_VERSION, SessionRecord } from '../../core/records.js';
import { q4, v3 } from '../../core/math.js';
import { buildPose, fistAngles } from '../../sim/handmodel.js';
import { TrackerNoise } from '../../sim/noise.js';
import { achievedPose, healthyParams, noiseSeed, PatientParams } from '../../sim/patient.js';
import { simulateHandPrint } from '../../sim/session.js';
import { DEMO_PERSONA } from '../../sim/persona.js';

/** A weak left hand that has recovered, over `sessions` days, to the demo persona's range today. */
function demoPatient(sessions: number): PatientParams {
  const weeks = sessions / 7;
  const today = DEMO_PERSONA.weakRange;
  const start = today.map((r) => r * 0.55);
  return {
    seed: 4242,
    range0: start,
    tone: 8,
    synergy: 0.5,
    slowness: 0.3,
    tremorAmp: 0,
    tremorHz: 5,
    trajectory: 'steady',
    gain8: (today[2] - start[2]) * (8 / Math.max(0.5, weeks)),
  };
}

export function seedHistory(sessions: number, understudy: Handedness = 'left'): SessionRecord[] {
  const lead: Handedness = understudy === 'left' ? 'right' : 'left';
  const p = demoPatient(sessions);
  const healthy = healthyParams(99);
  const tnU = new TrackerNoise(noiseSeed(p, 0));
  const tnL = new TrackerNoise(noiseSeed(healthy, 1));
  const now = Date.now();
  const out: SessionRecord[] = [];
  for (let i = 0; i < sessions; i++) {
    const week = i / 7;
    tnU.newSession();
    tnL.newSession();
    const own = simulateHandPrint(p, understudy, tnU, week, 100 + i * 7);
    const ref = simulateHandPrint(healthy, lead, tnL, 0, 900 + i * 7);
    const metrics: SessionRecord['metrics'] = {};
    const put = (h: Handedness, sp: typeof own) => {
      (['tam.index', 'tam.middle', 'tam.ring', 'tam.little'] as const).forEach((id, f) => {
        metrics[metricKey(h, id)] = { value: sp.value.tam[f], trials: sp.trials.map((t) => t.tam[f]), validShare: 1 };
      });
      metrics[metricKey(h, 'tam.total')] = { value: sp.value.tamTotal, trials: sp.trials.map((t) => t.tamTotal), validShare: 1 };
      metrics[metricKey(h, 'opening')] = { value: sp.value.opening, trials: sp.trials.map((t) => t.opening), validShare: 1 };
      metrics[metricKey(h, 'spread')] = { value: sp.value.spread, trials: sp.trials.map((t) => t.spread), validShare: 1 };
      metrics[metricKey(h, 'kapandji')] = { value: sp.value.kapandji, trials: sp.trials.map((t) => t.kapandji), validShare: 1 };
    };
    put(understudy, own);
    put(lead, ref);
    const fist = buildPose(achievedPose(p, fistAngles(), week), understudy, { length: 0.186 }, { position: v3(), orientation: q4() }, newPose());
    out.push({
      id: newSessionId(now - (sessions - i) * 86400000),
      startedAt: now - (sessions - i) * 86400000,
      endedAt: now - (sessions - i) * 86400000 + 9 * 60000,
      program: 'understudy',
      understudy,
      appVersion: APP_VERSION,
      calibrationHash: 'simulated',
      metrics,
      exercises: [{ id: 'flower', seconds: 0, reps: 6 }, { id: 'piano', seconds: 0, reps: 8 }, { id: 'thumb', seconds: 0, reps: 4 }, { id: 'tap', seconds: 10, reps: 16 }],
      completed: true,
      poses: { [understudy]: { fist: Array.from(fist, (x) => Math.round(x * 1e4) / 1e4) } },
      simulated: true,
    });
  }
  return out;
}
