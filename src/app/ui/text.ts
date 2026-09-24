/**
 * Text drawn to canvas textures in Atkinson Hyperlegible, a typeface designed
 * by the Braille Institute for low-vision readers. Canvas text lets every
 * label use it, offline, at any size.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from '@iwsdk/core';

export const FONT = '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif';
let fontsReady: Promise<void> | null = null;

export function loadFonts(base: string): Promise<void> {
  if (fontsReady) return fontsReady;
  const faces = [
    new FontFace('Atkinson Hyperlegible', `url(${base}fonts/atkinson-hyperlegible-latin-400-normal.woff2)`, { weight: '400' }),
    new FontFace('Atkinson Hyperlegible', `url(${base}fonts/atkinson-hyperlegible-latin-700-normal.woff2)`, { weight: '700' }),
  ];
  fontsReady = Promise.all(
    faces.map((f) =>
      f
        .load()
        .then((loaded) => {
          (document.fonts as FontFaceSet & { add(f: FontFace): void }).add(loaded);
        })
        .catch(() => undefined),
    ),
  ).then(() => undefined);
  return fontsReady;
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  return { canvas, ctx, texture };
}

/** Splits text into lines that fit `maxWidth` at the context's current font. */
export function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type IconName =
  | 'hand'
  | 'fist'
  | 'open'
  | 'check'
  | 'next'
  | 'back'
  | 'left'
  | 'right'
  | 'both'
  | 'mirror'
  | 'sun'
  | 'spark'
  | 'pause'
  | 'stop'
  | 'touch'
  | 'thumb'
  | 'cloth'
  | 'chart'
  | 'settings'
  | 'eye'
  | 'dot';

/** Simple line icons drawn with canvas paths, centred at (cx, cy), size s. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, cx: number, cy: number, s: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s / 100, s / 100);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const palm = () => {
    roundRect(ctx, -26, -6, 52, 46, 16);
    ctx.stroke();
  };
  const finger = (x: number, len: number) => {
    ctx.beginPath();
    ctx.moveTo(x, -6);
    ctx.lineTo(x, -6 - len);
    ctx.stroke();
  };
  switch (name) {
    case 'hand':
    case 'open':
      palm();
      finger(-18, 30);
      finger(-6, 40);
      finger(6, 38);
      finger(18, 28);
      ctx.beginPath();
      ctx.moveTo(-26, 14);
      ctx.lineTo(-44, -4);
      ctx.stroke();
      break;
    case 'fist':
      roundRect(ctx, -30, -24, 60, 56, 18);
      ctx.stroke();
      for (const x of [-15, 0, 15]) {
        ctx.beginPath();
        ctx.moveTo(x, -24);
        ctx.lineTo(x, -6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(-30, 8);
      ctx.lineTo(4, 8);
      ctx.stroke();
      break;
    case 'check':
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(-32, 2);
      ctx.lineTo(-10, 26);
      ctx.lineTo(34, -24);
      ctx.stroke();
      break;
    case 'next':
    case 'right':
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(-30, 0);
      ctx.lineTo(28, 0);
      ctx.moveTo(8, -22);
      ctx.lineTo(30, 0);
      ctx.lineTo(8, 22);
      ctx.stroke();
      break;
    case 'back':
    case 'left':
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(30, 0);
      ctx.lineTo(-28, 0);
      ctx.moveTo(-8, -22);
      ctx.lineTo(-30, 0);
      ctx.lineTo(-8, 22);
      ctx.stroke();
      break;
    case 'both':
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(34, 0);
      ctx.moveTo(-16, -18);
      ctx.lineTo(-34, 0);
      ctx.lineTo(-16, 18);
      ctx.moveTo(16, -18);
      ctx.lineTo(34, 0);
      ctx.lineTo(16, 18);
      ctx.stroke();
      break;
    case 'mirror':
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.moveTo(0, -40);
      ctx.lineTo(0, 40);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(-22, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(22, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'sun':
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 26, Math.sin(a) * 26);
        ctx.lineTo(Math.cos(a) * 38, Math.sin(a) * 38);
        ctx.stroke();
      }
      break;
    case 'spark':
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        const r = i % 2 ? 14 : 38;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'pause':
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(-14, -28);
      ctx.lineTo(-14, 28);
      ctx.moveTo(14, -28);
      ctx.lineTo(14, 28);
      ctx.stroke();
      break;
    case 'stop':
      roundRect(ctx, -28, -28, 56, 56, 10);
      ctx.fill();
      break;
    case 'touch':
      ctx.beginPath();
      ctx.arc(0, 10, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 10, 28, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 10, 44, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      break;
    case 'thumb':
      roundRect(ctx, -24, -4, 44, 40, 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, -4);
      ctx.lineTo(-4, -38);
      ctx.stroke();
      break;
    case 'cloth':
      ctx.beginPath();
      ctx.moveTo(-40, 24);
      ctx.bezierCurveTo(-30, -30, 30, -30, 40, 24);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'chart':
      ctx.beginPath();
      ctx.moveTo(-36, 30);
      ctx.lineTo(-12, 4);
      ctx.lineTo(6, 14);
      ctx.lineTo(34, -26);
      ctx.stroke();
      break;
    case 'settings':
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 22, Math.sin(a) * 22);
        ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 34);
        ctx.stroke();
      }
      break;
    case 'eye':
      ctx.beginPath();
      ctx.moveTo(-40, 0);
      ctx.quadraticCurveTo(0, -34, 40, 0);
      ctx.quadraticCurveTo(0, 34, -40, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}
