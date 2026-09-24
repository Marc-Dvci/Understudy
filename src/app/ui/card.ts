/**
 * The instruction card: icon, a title of at most five words, an optional line
 * of body text and a hint. Unlit so it stays readable in any room light.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from '@iwsdk/core';
import { PALETTE } from '../render/materials.js';
import { drawIcon, FONT, IconName, makeCanvas, roundRect, wrap } from './text.js';

export interface CardContent {
  icon?: IconName;
  title: string;
  body?: string;
  hint?: string;
  accent?: string;
  /** Optional step progress shown as dots. */
  step?: { index: number; total: number };
  /** Optional large number shown instead of the icon. */
  big?: string;
}

const PX_PER_M = 3200;

export class Card {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly c: ReturnType<typeof makeCanvas>;
  private content: CardContent = { title: '' };
  readonly width: number;
  readonly height: number;
  private key = '';
  opacity = 0;
  targetOpacity = 0;
  /** Set while the board is up: card and board never overlap. */
  suppressed = false;

  constructor(width = 0.36, height = 0.2, name = 'card') {
    this.width = width;
    this.height = height;
    this.c = makeCanvas(Math.round(width * PX_PER_M), Math.round(height * PX_PER_M));
    const mat = new MeshBasicMaterial({ map: this.c.texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    this.mesh = new Mesh(new PlaneGeometry(width, height), mat);
    this.mesh.renderOrder = 10;
    this.group.add(this.mesh);
    this.group.name = name;
    this.group.visible = false;
  }

  get text(): CardContent {
    return this.content;
  }

  show(content: CardContent): void {
    const key = JSON.stringify(content);
    this.content = content;
    this.targetOpacity = 1;
    this.group.visible = true;
    if (key !== this.key) {
      this.key = key;
      this.draw();
    }
  }

  hide(): void {
    this.targetOpacity = 0;
  }

  update(dt: number): void {
    const target = this.suppressed ? 0 : this.targetOpacity;
    this.opacity += (target - this.opacity) * (1 - Math.exp(-dt / 0.12));
    (this.mesh.material as MeshBasicMaterial).opacity = this.opacity;
    this.group.visible = this.opacity > 0.01;
  }

  private draw(): void {
    const { ctx, canvas, texture } = this.c;
    const W = canvas.width;
    const H = canvas.height;
    const c = this.content;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    roundRect(ctx, 16, 12, W - 32, H - 36, 56);
    ctx.fillStyle = 'rgba(250,247,241,0.96)';
    ctx.fill();
    ctx.restore();
    const accent = c.accent ?? PALETTE.understudy;
    ctx.fillStyle = accent;
    roundRect(ctx, 16, 12, 22, H - 36, 11);
    ctx.fill();

    const pad = 90;
    let x = pad;
    const iconSize = H * 0.36;
    if (c.big) {
      ctx.fillStyle = accent;
      ctx.font = `700 ${Math.round(H * 0.34)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(c.big, pad, H * 0.44);
      x = pad + ctx.measureText(c.big).width + 60;
    } else if (c.icon) {
      drawIcon(ctx, c.icon, pad + iconSize / 2, H * 0.44, iconSize, accent);
      x = pad + iconSize + 60;
    }
    const maxW = W - x - pad;
    ctx.fillStyle = PALETTE.ink;
    ctx.textBaseline = 'alphabetic';
    let titleSize = Math.round(H * 0.175);
    ctx.font = `700 ${titleSize}px ${FONT}`;
    let lines = wrap(ctx, c.title, maxW);
    while (lines.length > 2 && titleSize > H * 0.1) {
      titleSize -= 4;
      ctx.font = `700 ${titleSize}px ${FONT}`;
      lines = wrap(ctx, c.title, maxW);
    }
    const bodySize = Math.round(H * 0.11);
    const bodyLines = c.body ? (ctx.font = `400 ${bodySize}px ${FONT}`, wrap(ctx, c.body, maxW)) : [];
    const blockH = lines.length * titleSize * 1.12 + (bodyLines.length ? 24 + bodyLines.length * bodySize * 1.25 : 0);
    let y = H * 0.46 - blockH / 2 + titleSize * 0.85;
    ctx.font = `700 ${titleSize}px ${FONT}`;
    for (const l of lines) {
      ctx.fillText(l, x, y);
      y += titleSize * 1.12;
    }
    if (bodyLines.length) {
      y += 24 - titleSize * 0.12;
      ctx.font = `400 ${bodySize}px ${FONT}`;
      ctx.fillStyle = '#334155';
      for (const l of bodyLines.slice(0, 3)) {
        ctx.fillText(l, x, y);
        y += bodySize * 1.25;
      }
    }
    if (c.hint) {
      ctx.font = `400 ${Math.round(H * 0.085)}px ${FONT}`;
      ctx.fillStyle = PALETTE.muted;
      ctx.fillText(c.hint, x, H - 70);
    }
    if (c.step) {
      const n = c.step.total;
      const r = 11;
      const gap = 34;
      const sx = W - pad - (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(sx + i * gap, H - 78, r, 0, Math.PI * 2);
        ctx.fillStyle = i <= c.step.index ? accent : '#d6d0c4';
        ctx.fill();
      }
    }
    texture.needsUpdate = true;
  }
}
