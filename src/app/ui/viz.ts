/**
 * Board drawings: the hand print, the drift ruler, per-finger shares and
 * progress lines. All draw into a canvas at the board's resolution.
 */
import { Handedness } from '../../core/joints.js';
import { DriftResult } from '../../core/embodiment.js';
import { PALETTE } from '../render/materials.js';
import { FONT, roundRect, wrap as wrapText } from './text.js';

export interface PrintView {
  hand: Handedness;
  role: 'lead' | 'understudy' | 'both';
  tam: number[];
  tamTotal: number;
  opening: number;
  kapandji: number;
  mdc: number[];
}

function backdrop(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, 14, 12, w - 28, h - 34, 48);
  ctx.fillStyle = 'rgba(250,247,241,0.97)';
  ctx.fill();
  ctx.restore();
}

function ease(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Little'];

/** Two fans of petals, one per hand; petal length is the finger's range of motion. */
export function drawHandPrint(views: PrintView[], title: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    backdrop(ctx, w, h);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `700 ${Math.round(h * 0.075)}px ${FONT}`;
    ctx.fillText(title, 70, h * 0.13);
    const k = ease(t / 1.2);
    views.forEach((v, idx) => {
      const cx = w * (views.length === 1 ? 0.5 : idx === 0 ? 0.27 : 0.73);
      const cy = h * 0.8;
      const color = v.role === 'lead' ? PALETTE.lead : v.role === 'understudy' ? PALETTE.understudy : '#7a8a99';
      const maxLen = h * 0.44;
      // labels sit on one arc past the longest petal, so a short petal never
      // crowds its neighbours' labels
      const labelR = maxLen + h * 0.08;
      // fan: little finger to index, left hand mirrored so thumbs point inward
      const dir = v.hand === 'left' ? 1 : -1;
      for (let f = 0; f < 4; f++) {
        const angle = -Math.PI / 2 + dir * (0.63 - f * 0.42);
        const val = v.tam[f];
        const len = Number.isFinite(val) ? Math.max(0.05, Math.min(1, val / 280)) * maxLen * k : maxLen * 0.05;
        const err = Number.isFinite(v.mdc[f]) ? (v.mdc[f] / 280) * maxLen * k : 0;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        // error band
        ctx.fillStyle = color + '33';
        roundRect(ctx, len - err, -30, err * 2, 60, 26);
        ctx.fill();
        // petal
        const g = ctx.createLinearGradient(0, 0, len, 0);
        g.addColorStop(0, color + '55');
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        roundRect(ctx, 0, -20, Math.max(40, len), 40, 20);
        ctx.fill();
        ctx.restore();
        // label at the petal tip
        const lx = cx + Math.cos(angle) * labelR;
        const ly = cy + Math.sin(angle) * labelR;
        ctx.textAlign = 'center';
        ctx.fillStyle = PALETTE.ink;
        ctx.font = `700 ${Math.round(h * 0.06)}px ${FONT}`;
        ctx.fillText(Number.isFinite(val) ? `${Math.round(val * k)}°` : '--', lx, ly);
        ctx.font = `400 ${Math.round(h * 0.04)}px ${FONT}`;
        ctx.fillStyle = PALETTE.muted;
        ctx.fillText(`${FINGER_NAMES[f]}${Number.isFinite(v.mdc[f]) ? ` ±${Math.round(v.mdc[f])}` : ''}`, lx, ly + h * 0.05);
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.font = `700 ${Math.round(h * 0.065)}px ${FONT}`;
      const roleLabel = v.role === 'lead' ? 'Lead' : v.role === 'understudy' ? 'Understudy' : '';
      ctx.fillText(`${v.hand === 'left' ? 'Left' : 'Right'} hand${roleLabel ? ` · ${roleLabel}` : ''}`, cx, h * 0.91);
      ctx.textAlign = 'left';
    });
  };
}

/** A ruler from the hidden hand to the virtual hand with the touches. */
export function drawDrift(d: DriftResult, offsetCm: number, sentence: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    backdrop(ctx, w, h);
    const k = ease(t / 1.4);
    ctx.fillStyle = PALETTE.understudy;
    ctx.font = `700 ${Math.round(h * 0.2)}px ${FONT}`;
    const big = Number.isFinite(d.driftCm) ? `${(d.driftCm * k).toFixed(1)} cm` : '--';
    ctx.fillText(big, 70, h * 0.3);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `400 ${Math.round(h * 0.058)}px ${FONT}`;
    const words = sentence.split(' ');
    let line = '';
    let y = h * 0.42;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > w - 140) {
        ctx.fillText(line, 70, y);
        line = word;
        y += h * 0.07;
      } else line = test;
    }
    ctx.fillText(line, 70, y);
    // ruler
    const x0 = 110;
    const x1 = w - 110;
    const ry = h * 0.76;
    const cmToX = (cm: number) => x0 + ((cm + 2) / (offsetCm + 4)) * (x1 - x0);
    ctx.strokeStyle = '#b8b0a2';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x0, ry);
    ctx.lineTo(x1, ry);
    ctx.stroke();
    const mark = (cm: number, label: string, color: string) => {
      const x = cmToX(cm);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, ry, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${Math.round(h * 0.04)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, ry + h * 0.1);
      ctx.textAlign = 'left';
    };
    mark(0, 'Hidden hand', PALETTE.ink);
    mark(offsetCm, 'Virtual hand', PALETTE.understudy);
    const pre = d.pre.reduce((a, b) => a + b, 0) / Math.max(1, d.pre.length);
    const post = d.post.reduce((a, b) => a + b, 0) / Math.max(1, d.post.length);
    ctx.fillStyle = '#9aa5b1';
    for (const p of d.pre) {
      ctx.beginPath();
      ctx.arc(cmToX(p), ry - 34, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.understudy;
    for (const p of d.post) {
      ctx.beginPath();
      ctx.arc(cmToX(pre + (p - pre) * k), ry - 34, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    if (Number.isFinite(post - pre)) {
      ctx.strokeStyle = PALETTE.understudy;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(cmToX(pre), ry - 64);
      ctx.lineTo(cmToX(pre + (post - pre) * k), ry - 64);
      ctx.stroke();
    }
  };
}

/** Per-finger performing share: how much of each finger's movement is its own. */
export function drawShares(shares: number[], stageLabel: string, attempt: number[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    backdrop(ctx, w, h);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `700 ${Math.round(h * 0.075)}px ${FONT}`;
    ctx.fillText(stageLabel, 70, h * 0.14);
    const names = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    const k = ease(t / 1);
    const bw = (w - 200) / 5;
    for (let f = 0; f < 5; f++) {
      const x = 100 + f * bw;
      const top = h * 0.24;
      const bottom = h * 0.74;
      roundRect(ctx, x + bw * 0.2, top, bw * 0.6, bottom - top, 24);
      ctx.fillStyle = '#e7e1d6';
      ctx.fill();
      const v = Math.max(0, Math.min(1, shares[f] ?? 0)) * k;
      const hh = (bottom - top) * v;
      roundRect(ctx, x + bw * 0.2, bottom - hh, bw * 0.6, Math.max(8, hh), 24);
      ctx.fillStyle = PALETTE.understudy;
      ctx.fill();
      if (attempt[f] > 0.05) {
        ctx.strokeStyle = PALETTE.good;
        ctx.lineWidth = 8 * attempt[f];
        roundRect(ctx, x + bw * 0.2 - 6, top - 6, bw * 0.6 + 12, bottom - top + 12, 28);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.fillStyle = PALETTE.ink;
      ctx.font = `700 ${Math.round(h * 0.055)}px ${FONT}`;
      ctx.fillText(`${Math.round((shares[f] ?? 0) * 100)}%`, x + bw / 2, h * 0.84);
      ctx.font = `400 ${Math.round(h * 0.04)}px ${FONT}`;
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(names[f], x + bw / 2, h * 0.9);
      ctx.textAlign = 'left';
    }
  };
}

export interface ProgressRow {
  label: string;
  unit: string;
  values: number[];
  band: [number, number] | null;
  change: 'improved' | 'declined' | 'steady' | 'unknown';
  latest: number;
  mdc: number;
}

/** Progress lines with the usual-range band; only real changes get a mark. */
export function drawProgress(rows: ProgressRow[], title: string) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    backdrop(ctx, w, h);
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `700 ${Math.round(h * 0.09)}px ${FONT}`;
    ctx.fillText(title, 70, h * 0.14);
    const k = ease(t / 1.2);
    const rowH = (h * 0.74) / Math.max(1, rows.length);
    rows.forEach((r, i) => {
      const y0 = h * 0.2 + i * rowH;
      const vals = r.values.filter(Number.isFinite);
      ctx.fillStyle = PALETTE.ink;
      ctx.font = `700 ${Math.round(Math.min(rowH * 0.34, h * 0.075))}px ${FONT}`;
      ctx.fillText(r.label, 70, y0 + rowH * 0.42);
      ctx.font = `400 ${Math.round(Math.min(rowH * 0.28, h * 0.062))}px ${FONT}`;
      ctx.fillStyle = PALETTE.muted;
      const val = Number.isFinite(r.latest) ? `${Math.round(r.latest)}${r.unit}` : '--';
      ctx.fillText(`${val}  ±${Math.round(r.mdc)}`, 70, y0 + rowH * 0.78);
      const x0 = w * 0.42;
      const x1 = w - 180;
      if (vals.length >= 2) {
        const lo = Math.min(...vals, r.band?.[0] ?? Infinity) - 5;
        const hi = Math.max(...vals, r.band?.[1] ?? -Infinity) + 5;
        const Y = (v: number) => y0 + rowH * 0.85 - ((v - lo) / (hi - lo)) * rowH * 0.7;
        const X = (j: number) => x0 + (j / (vals.length - 1)) * (x1 - x0);
        if (r.band) {
          ctx.fillStyle = 'rgba(76,155,232,0.12)';
          ctx.fillRect(x0, Y(r.band[1]), x1 - x0, Y(r.band[0]) - Y(r.band[1]));
        }
        ctx.strokeStyle = PALETTE.understudy;
        ctx.lineWidth = 6;
        ctx.beginPath();
        const n = Math.max(2, Math.ceil(vals.length * k));
        for (let j = 0; j < n && j < vals.length; j++) {
          if (j === 0) ctx.moveTo(X(j), Y(vals[j]));
          else ctx.lineTo(X(j), Y(vals[j]));
        }
        ctx.stroke();
        ctx.fillStyle = PALETTE.understudy;
        ctx.beginPath();
        ctx.arc(X(vals.length - 1), Y(vals[vals.length - 1]), 12, 0, Math.PI * 2);
        ctx.fill();
      }
      const tag = r.change === 'improved' ? 'Real gain' : r.change === 'declined' ? 'Real drop' : r.change === 'steady' ? 'Steady' : 'New';
      const tagColor = r.change === 'improved' ? PALETTE.good : r.change === 'declined' ? PALETTE.caution : PALETTE.muted;
      ctx.fillStyle = tagColor;
      ctx.font = `700 ${Math.round(Math.min(rowH * 0.3, h * 0.065))}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(tag, w - 60, y0 + rowH * 0.55);
      ctx.textAlign = 'left';
    });
  };
}

/** A single large message on the board. */
export function drawMessage(title: string, lines: string[], accent = PALETTE.understudy) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    backdrop(ctx, w, h);
    ctx.fillStyle = accent;
    roundRect(ctx, 14, 12, 20, h - 34, 10);
    ctx.fill();
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `700 ${Math.round(h * 0.13)}px ${FONT}`;
    ctx.fillText(title, 80, h * 0.22);
    ctx.font = `400 ${Math.round(h * 0.085)}px ${FONT}`;
    ctx.fillStyle = '#334155';
    let y = h * 0.4;
    for (const l of lines) {
      for (const part of wrapText(ctx, l, w - 160)) {
        if (y > h * 0.92) break;
        ctx.fillText(part, 80, y);
        y += h * 0.105;
      }
      y += h * 0.02;
    }
  };
}

/** The flat meter strip: five small gauges, one per finger, ringed while that finger is trying. */
export function drawMeter(shares: number[], stageLabel: string, attempt: number[]) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    roundRect(ctx, 6, 6, w - 12, h - 12, h * 0.22);
    ctx.fillStyle = 'rgba(250,247,241,0.95)';
    ctx.fill();
    ctx.restore();
    const names = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    ctx.fillStyle = PALETTE.ink;
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(h * 0.15)}px ${FONT}`;
    ctx.fillText(stageLabel, w / 2, h * 0.22);
    const gw = (w - 40) / 5;
    for (let f = 0; f < 5; f++) {
      const cx = 20 + gw * (f + 0.5);
      const cy = h * 0.52;
      const r = Math.min(gw * 0.3, h * 0.19);
      ctx.lineWidth = r * 0.3;
      ctx.strokeStyle = '#e1dacd';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const v = Math.max(0, Math.min(1, shares[f] ?? 0));
      ctx.strokeStyle = PALETTE.understudy;
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + v * Math.PI * 2);
      ctx.stroke();
      if ((attempt[f] ?? 0) > 0.05) {
        ctx.strokeStyle = PALETTE.good;
        ctx.globalAlpha = Math.min(1, attempt[f]);
        ctx.lineWidth = r * 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.42, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = PALETTE.ink;
      ctx.font = `700 ${Math.round(r * 0.8)}px ${FONT}`;
      ctx.fillText(`${Math.round(v * 100)}`, cx, cy + r * 0.3);
      ctx.font = `400 ${Math.round(h * 0.12)}px ${FONT}`;
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(names[f], cx, h * 0.9);
    }
    ctx.textAlign = 'left';
  };
}
