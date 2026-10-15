/**
 * Printable session summary: one self-contained HTML page per programme, built
 * from the completed sessions and the profile. Pure: no DOM, and the generation
 * time comes in as a parameter.
 */
import { Handedness } from './joints.js';
import { METRICS, MetricId } from './measure.js';
import {
  APP_VERSION,
  historyFor,
  metricKey,
  PROGRAM_LABEL,
  Profile,
  progressFor,
  seriesFor,
  sharesFromHistory,
  SessionRecord,
} from './records.js';
import { Change } from './stats.js';

const DASH = '—';
const TITLE = 'Understudy: session summary';
const SPARK_W = 160;
const SPARK_H = 36;
const SPARK_PAD = 3;
const BAND_FILL = '#dcdcdc';
const SIMULATED_NOTICE = 'Contains simulated sample sessions. These are not a person\'s measurements.';
const FOOTER = 'Exercise prototype. Measurements are hand-tracking estimates with the stated margins. Not a diagnosis. Follow your care team\'s advice.';

const VERDICT: Record<Change, string> = {
  improved: 'Improved beyond margin',
  declined: 'Declined beyond margin',
  steady: 'Within margin',
  unknown: 'Not comparable yet',
};

const FINGERS: [MetricId, string][] = [
  ['tam.index', 'Index finger'],
  ['tam.middle', 'Middle finger'],
  ['tam.ring', 'Ring finger'],
  ['tam.little', 'Little finger'],
];

const CSS = `
@page { size: A4; margin: 14mm; }
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { background: #fff; color: #000; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 13px; line-height: 1.4; }
main { max-width: 180mm; margin: 0 auto; padding: 16px; }
h1 { font-size: 20px; margin: 0 0 10px; }
h2 { font-size: 15px; margin: 18px 0 6px; padding-bottom: 2px; border-bottom: 1px solid #000; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 3px 14px; margin: 0; }
dt { font-weight: 600; }
dd { margin: 0; }
.notice { border: 2px solid #000; padding: 8px 10px; margin: 12px 0 0; font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #000; vertical-align: middle; }
th { font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
td.trend { width: 166px; padding-top: 2px; padding-bottom: 2px; }
svg { display: block; }
.note { font-size: 11px; margin: 6px 0 0; }
footer { margin-top: 18px; border-top: 1px solid #000; padding-top: 6px; font-size: 11px; }
footer p { margin: 0 0 3px; }
@media print {
  html, body { background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: none; padding: 0; }
  h2, table, .notice, footer, tr { break-inside: avoid; }
}
`;

/** Escapes the five characters that matter in HTML text and attribute values. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unitSuffix(unit: string): string {
  if (unit === 'deg') return '°';
  if (!unit) return '';
  return /^[%/]/.test(unit) ? unit : ` ${unit}`;
}

function formatValue(v: number, decimals: number, unit: string): string {
  return Number.isFinite(v) ? `${v.toFixed(decimals)}${unitSuffix(unit)}` : DASH;
}

/** Signed difference; a value that rounds to zero is shown without a sign. */
function formatChange(v: number, decimals: number, unit: string): string {
  if (!Number.isFinite(v)) return DASH;
  const shown = Math.abs(v).toFixed(decimals);
  if (Number(shown) === 0) return `0${unitSuffix(unit)}`;
  return `${v < 0 ? '-' : '+'}${shown}${unitSuffix(unit)}`;
}

function isoDate(ms: number): string {
  if (!Number.isFinite(ms)) return DASH;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? DASH : d.toISOString().slice(0, 10);
}

function programLabel(program: string): string {
  const labels = new Map<string, string>([...Object.entries(PROGRAM_LABEL), ['deskbreak', 'Desk break']]);
  return labels.get(program) ?? program;
}

interface Plan {
  ids: MetricId[];
  hands: Handedness[];
  /** True when both hands are shown, so each row names its hand. */
  bothHands: boolean;
}

/** Metric ids by programme. The practised hand falls back to left, as progress.ts does. */
function planFor(program: string, profile: Profile): Plan {
  const practised: Handedness = profile.understudy ?? 'left';
  if (program === 'understudy') {
    return { ids: ['tam.index', 'tam.middle', 'tam.ring', 'tam.little', 'tam.total', 'opening'], hands: [practised], bothHands: false };
  }
  if (program === 'phantom') {
    return { ids: ['pain'], hands: [practised], bothHands: false };
  }
  if (program === 'warmup') {
    return { ids: ['warmup.stiffness', 'tam.total'], hands: ['left', 'right'], bothHands: true };
  }
  if (program === 'deskbreak') {
    return { ids: ['tam.total', 'spread', 'opening'], hands: ['left', 'right'], bothHands: true };
  }
  return { ids: [], hands: [], bothHands: false };
}

interface Row {
  label: string;
  unit: string;
  decimals: number;
  first: number;
  latest: number;
  change: number;
  mdc: number;
  verdict: string;
  series: number[];
  band: [number, number] | null;
}

function buildRows(history: SessionRecord[], plan: Plan): Row[] {
  const rows: Row[] = [];
  for (const id of plan.ids) {
    for (const hand of plan.hands) {
      const progress = progressFor(history, hand, id);
      if (progress.sessions === 0) continue;
      const def = METRICS[id];
      const series = seriesFor(history, metricKey(hand, id));
      const change =
        Number.isFinite(progress.latest) && Number.isFinite(progress.baseline) ? progress.latest - progress.baseline : NaN;
      const usual = progress.usual;
      const band: [number, number] | null =
        usual && Number.isFinite(usual.low) && Number.isFinite(usual.high) ? [usual.low, usual.high] : null;
      rows.push({
        label: plan.bothHands ? `${def.label} (${hand})` : def.label,
        unit: def.unit,
        decimals: def.decimals,
        first: series.find((v) => Number.isFinite(v)) ?? NaN,
        latest: progress.latest,
        change,
        mdc: progress.error.mdc,
        verdict: VERDICT[progress.change],
        series,
        band,
      });
    }
  }
  return rows;
}

/** One inline SVG trend line; gaps where a session has no value, grey band for the usual range. */
function sparkline(series: number[], band: [number, number] | null, label: string): string {
  const points = series.map((v, i) => ({ i, v })).filter((p) => Number.isFinite(p.v));
  if (points.length === 0) return '';
  const n = series.length;
  const x = (i: number) => (n > 1 ? SPARK_PAD + (i / (n - 1)) * (SPARK_W - 2 * SPARK_PAD) : SPARK_W / 2);
  let lo = points.reduce((m, p) => Math.min(m, p.v), Infinity);
  let hi = points.reduce((m, p) => Math.max(m, p.v), -Infinity);
  if (band) {
    lo = Math.min(lo, band[0]);
    hi = Math.max(hi, band[1]);
  }
  const span = hi - lo;
  const pad = span > 0 ? span * 0.1 : 1;
  lo -= pad;
  hi += pad;
  const y = (v: number) => SPARK_H - SPARK_PAD - ((v - lo) / (hi - lo)) * (SPARK_H - 2 * SPARK_PAD);
  const parts: string[] = [];
  if (band) {
    const top = y(band[1]);
    const bottom = y(band[0]);
    parts.push(
      `<rect x="0" y="${top.toFixed(1)}" width="${SPARK_W}" height="${Math.max(0, bottom - top).toFixed(1)}" fill="${BAND_FILL}"/>`,
    );
  }
  if (points.length === 1) {
    parts.push(`<circle cx="${x(points[0].i).toFixed(1)}" cy="${y(points[0].v).toFixed(1)}" r="2.5" fill="#000"/>`);
  } else {
    const path = points.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    parts.push(`<polyline fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" points="${path}"/>`);
  }
  return `<svg width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img" aria-label="${esc(label)} over time">${parts.join('')}</svg>`;
}

function rowHtml(r: Row): string {
  const value = (v: number) => formatValue(v, r.decimals, r.unit);
  return (
    `<tr><td>${esc(r.label)}</td>` +
    `<td class="num">${value(r.first)}</td>` +
    `<td class="num">${value(r.latest)}</td>` +
    `<td class="num">${formatChange(r.change, r.decimals, r.unit)}</td>` +
    `<td class="num">${value(r.mdc)}</td>` +
    `<td>${esc(r.verdict)}</td>` +
    `<td class="trend">${sparkline(r.series, r.band, r.label)}</td></tr>`
  );
}

function measuresHtml(history: SessionRecord[], rows: Row[]): string {
  if (history.length === 0) return '<p>No completed sessions yet.</p>';
  if (rows.length === 0) return '<p>No measurements recorded for this programme yet.</p>';
  return (
    '<table><thead><tr>' +
    '<th>Measure</th><th class="num">First</th><th class="num">Latest</th><th class="num">Change</th>' +
    '<th class="num">Margin (MDC95)</th><th>Verdict</th><th>Trend</th>' +
    '</tr></thead><tbody>' +
    rows.map(rowHtml).join('') +
    '</tbody></table>' +
    '<p class="note">Change is the latest value minus the baseline: the median of the first three sessions, or the value 14 sessions before the latest once there are more than 14. ' +
    'MDC95 is the smallest change that can be told apart from measurement error at 95% confidence. A change counts as improved or declined only when it is larger than the margin.</p>'
  );
}

/** Assistance is 100% minus the finger's own share. Each finger is shown with both numbers. */
function assistanceHtml(history: SessionRecord[], hand: Handedness): string {
  const shares = sharesFromHistory(history, hand);
  const rows = FINGERS.map(([id, name], f) => {
    const measured = seriesFor(history, metricKey(hand, id)).some((v) => Number.isFinite(v)) && Number.isFinite(shares[f]);
    if (!measured) {
      return `<tr><td>${name}</td><td class="num">${DASH}</td><td class="num">${DASH}</td></tr>`;
    }
    const own = Math.round(shares[f] * 100);
    return `<tr><td>${name}</td><td class="num">${own}%</td><td class="num">${100 - own}%</td></tr>`;
  });
  return (
    '<h2>Assistance per finger today</h2>' +
    '<p class="note">Own share is how much of the finger\'s movement is its own. Assistance is 100% minus own share.</p>' +
    '<table><thead><tr><th>Finger</th><th class="num">Own share</th><th class="num">Assistance</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>` +
    '<p>Assistance changes only when a finger\'s measured range moves more than its margin of error.</p>'
  );
}

function painHtml(history: SessionRecord[]): string {
  const def = METRICS.pain;
  const recent = history.slice(-10);
  const rows = recent.map(
    (r) =>
      `<tr><td>${isoDate(r.startedAt)}</td>` +
      `<td class="num">${formatValue(r.painBefore ?? NaN, def.decimals, def.unit)}</td>` +
      `<td class="num">${formatValue(r.painAfter ?? NaN, def.decimals, def.unit)}</td></tr>`,
  );
  return (
    `<h2>Pain in the last ${recent.length} session${recent.length === 1 ? '' : 's'}</h2>` +
    '<table><thead><tr><th>Date</th><th class="num">Pain before</th><th class="num">Pain after</th></tr></thead>' +
    `<tbody>${rows.join('')}</tbody></table>`
  );
}

/**
 * A complete standalone HTML5 page (A4 when printed) summarising one
 * programme's completed sessions. Records are sorted by start time before use,
 * because the progress and share helpers read them in order.
 */
export function careSummaryHtml(records: SessionRecord[], profile: Profile, options: { generatedAt: number }): string {
  const program: string = profile.program;
  const history = historyFor(records, profile.program, profile.understudy).sort((a, b) => a.startedAt - b.startedAt);
  const plan = planFor(program, profile);
  const rows = history.length ? buildRows(history, plan) : [];
  const simulated = history.some((r) => r.simulated === true);
  const practised: Handedness = profile.understudy ?? 'left';
  const first = isoDate(history.length ? history[0].startedAt : NaN);
  const last = isoDate(history.length ? history[history.length - 1].startedAt : NaN);
  const covered = !history.length ? DASH : first === last ? first : `${first} to ${last}`;
  const handLabel = profile.understudy ? `${profile.understudy} hand` : 'both hands';

  const sections = [
    `<h1>${TITLE}</h1>`,
    '<dl>' +
      `<dt>Programme</dt><dd>${esc(programLabel(program))}</dd>` +
      `<dt>Hand</dt><dd>${esc(handLabel)}</dd>` +
      `<dt>Generated (UTC)</dt><dd>${isoDate(options.generatedAt)}</dd>` +
      `<dt>Completed sessions</dt><dd>${history.length}</dd>` +
      `<dt>Dates covered</dt><dd>${covered}</dd>` +
      '</dl>',
    simulated ? `<div class="notice" role="note">${SIMULATED_NOTICE}</div>` : '',
    '<h2>Measures</h2>',
    measuresHtml(history, rows),
    program === 'understudy' && history.length ? assistanceHtml(history, practised) : '',
    program === 'phantom' && history.length ? painHtml(history) : '',
    `<footer><p>${FOOTER}</p><p>App ${esc(APP_VERSION)}</p></footer>`,
  ];

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${TITLE}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    ...sections,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}
