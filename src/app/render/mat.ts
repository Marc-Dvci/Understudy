/**
 * The linen mat anchored on the real table, with the two resting places for
 * the hands and the midline the mirror reflects across.
 */
import { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, ShapeGeometry, Shape } from '@iwsdk/core';
import { rng } from '../../core/math.js';
import { FONT, makeCanvas, roundRect } from '../ui/text.js';
import { PALETTE } from './materials.js';

export const MAT_W = 0.64;
export const MAT_D = 0.38;

function roundedRectShape(w: number, h: number, r: number): Shape {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export class Mat {
  readonly group = new Group();
  private readonly surface: Mesh;
  private readonly overlay: Mesh;
  private readonly overlayCanvas: ReturnType<typeof makeCanvas>;
  private appear = 0;
  private target = 0;
  private scaleXZ = 1;
  showRests = true;
  showMidline = false;
  restLeft = { u: -0.16, v: -0.05 };
  restRight = { u: 0.16, v: -0.05 };
  /** Words printed on the mat at (u, v), for example under the progress hands. */
  labels: { u: number; v: number; text: string; color: string; align?: CanvasTextAlign }[] = [];
  private dirty = true;
  private pulse = 0;

  constructor() {
    const tex = makeCanvas(1024, 608);
    const { ctx, canvas } = tex;
    // linen: warm base, fine weave, gentle vignette
    ctx.fillStyle = PALETTE.mat;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const r = rng(42);
    for (let i = 0; i < 9000; i++) {
      const x = r() * canvas.width;
      const y = r() * canvas.height;
      const l = 220 + Math.floor(r() * 30);
      ctx.fillStyle = `rgba(${l},${l - 8},${l - 20},0.18)`;
      ctx.fillRect(x, y, r() < 0.5 ? 6 : 1, r() < 0.5 ? 1 : 6);
    }
    for (let y = 0; y < canvas.height; y += 4) {
      ctx.fillStyle = `rgba(160,140,110,${0.03 + r() * 0.02})`;
      ctx.fillRect(0, y, canvas.width, 1);
    }
    const g = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 100, canvas.width / 2, canvas.height / 2, 620);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(120,100,80,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    tex.texture.needsUpdate = true;

    const geo = new ShapeGeometry(roundedRectShape(MAT_W, MAT_D, 0.035), 12);
    // map UVs from shape coordinates
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / MAT_W + 0.5, pos.getY(i) / MAT_D + 0.5);
    this.surface = new Mesh(geo, new MeshStandardMaterial({ map: tex.texture, roughness: 0.95, transparent: true, opacity: 0 }));
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.position.y = 0.0008;
    this.surface.renderOrder = 1;
    this.group.add(this.surface);

    this.overlayCanvas = makeCanvas(1280, 760);
    this.overlay = new Mesh(
      new PlaneGeometry(MAT_W, MAT_D),
      new MeshBasicMaterial({ map: this.overlayCanvas.texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.overlay.rotation.x = -Math.PI / 2;
    this.overlay.position.y = 0.0016;
    this.overlay.renderOrder = 2;
    this.group.add(this.overlay);
    this.group.name = 'station-mat';
    this.group.visible = false;
  }

  show(lap = false): void {
    this.target = 1;
    this.scaleXZ = lap ? 0.72 : 1;
    this.group.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Makes the resting places glow briefly, for "rest your hands here". */
  pulseRests(): void {
    this.pulse = 1.6;
  }

  update(dt: number): void {
    this.appear += (this.target - this.appear) * (1 - Math.exp(-dt / 0.35));
    this.group.visible = this.appear > 0.01;
    const s = 0.6 + 0.4 * this.appear;
    this.group.scale.set(s * this.scaleXZ, 1, s * this.scaleXZ);
    (this.surface.material as MeshStandardMaterial).opacity = this.appear;
    (this.overlay.material as MeshBasicMaterial).opacity = this.appear;
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt);
      this.dirty = true;
    }
    if (this.dirty) this.drawOverlay();
  }

  private drawOverlay(): void {
    this.dirty = false;
    const { ctx, canvas, texture } = this.overlayCanvas;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const toPx = (u: number, v: number) => [(u / MAT_W + 0.5) * W, (0.5 - v / MAT_D) * H];
    ctx.strokeStyle = 'rgba(110,95,75,0.35)';
    ctx.lineWidth = 3;
    roundRect(ctx, 10, 10, W - 20, H - 20, 70);
    ctx.stroke();
    if (this.showMidline) {
      ctx.setLineDash([14, 16]);
      ctx.strokeStyle = 'rgba(76,155,232,0.55)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(W / 2, 40);
      ctx.lineTo(W / 2, H - 40);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.showRests) {
      const glow = this.pulse > 0 ? 0.35 + 0.35 * Math.sin(this.pulse * 8) ** 2 : 0.3;
      for (const [rest, color] of [
        [this.restLeft, PALETTE.lead],
        [this.restRight, PALETTE.lead],
      ] as const) {
        const [x, y] = toPx(rest.u, rest.v);
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = `rgba(255,255,255,${glow * 0.6})`;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(0, -30, 105, 190, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    for (const l of this.labels) {
      const [x, y] = toPx(l.u, l.v);
      ctx.font = `700 36px ${FONT}`;
      ctx.textAlign = l.align ?? 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, y);
      ctx.textAlign = 'start';
    }
    texture.needsUpdate = true;
  }
}
