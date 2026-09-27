/**
 * A stone button lying on the real table. Pressing it presses the table, so
 * every press ends on a physical surface: passive haptics without hardware.
 */
import {
  CircleGeometry,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector2,
} from '@iwsdk/core';
import { PALETTE } from '../render/materials.js';
import { drawIcon, FONT, IconName, makeCanvas, wrap } from './text.js';

export interface StoneOptions {
  id: string;
  label: string;
  icon?: IconName;
  accent?: string;
  radius?: number;
  /** Secondary line under the label. */
  sub?: string;
}

function stoneGeometry(radius: number, height: number): LatheGeometry {
  const pts: Vector2[] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // superellipse profile: flat top, rounded rim
    const a = (t * Math.PI) / 2;
    const x = radius * Math.pow(Math.cos(a), 0.35);
    const y = height * Math.pow(Math.sin(a), 0.6);
    pts.push(new Vector2(Math.max(0.0001, x), y));
  }
  pts.push(new Vector2(0.0001, height));
  return new LatheGeometry(pts, 48);
}

export class Stone {
  readonly id: string;
  readonly group = new Group();
  readonly radius: number;
  readonly height = 0.016;
  private readonly body: Mesh;
  private readonly face: Mesh;
  private readonly ring: Mesh;
  private readonly bodyMat: MeshStandardMaterial;
  private readonly ringMat: MeshBasicMaterial;
  private readonly faceCanvas: ReturnType<typeof makeCanvas>;
  private opts: StoneOptions;
  hover = 0;
  /** Dwell progress 0..1, drawn as the ring filling. */
  dwell = 0;
  pressed = 0;
  enabled = true;
  selected = false;
  visibleTarget = false;
  private appear = 0;

  constructor(opts: StoneOptions) {
    this.id = opts.id;
    this.opts = opts;
    this.radius = opts.radius ?? 0.05;
    this.bodyMat = new MeshStandardMaterial({ color: new Color('#f4efe6'), roughness: 0.72, metalness: 0 });
    this.body = new Mesh(stoneGeometry(this.radius, this.height), this.bodyMat);
    this.group.add(this.body);
    this.faceCanvas = makeCanvas(512, 512);
    this.face = new Mesh(
      new CircleGeometry(this.radius * 0.86, 48),
      new MeshBasicMaterial({ map: this.faceCanvas.texture, transparent: true, depthWrite: false, toneMapped: false }),
    );
    this.face.rotation.x = -Math.PI / 2;
    this.face.position.y = this.height + 0.0006;
    this.face.renderOrder = 6;
    this.group.add(this.face);
    this.ringMat = new MeshBasicMaterial({ color: new Color(opts.accent ?? PALETTE.understudy), transparent: true, opacity: 0, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(this.radius * 1.08, this.radius * 1.2, 64, 1, 0, Math.PI * 2), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.001;
    this.ring.renderOrder = 5;
    this.group.add(this.ring);
    this.group.name = `stone-${opts.id}`;
    this.group.visible = false;
    this.group.scale.setScalar(0.001);
    this.drawFace();
  }

  setLabel(label: string, sub?: string, icon?: IconName): void {
    this.opts = { ...this.opts, label, sub, icon: icon ?? this.opts.icon };
    this.drawFace();
  }

  private drawFace(): void {
    const { ctx, canvas, texture } = this.faceCanvas;
    const W = canvas.width;
    ctx.clearRect(0, 0, W, W);
    const accent = this.opts.accent ?? PALETTE.understudy;
    const hasIcon = !!this.opts.icon;
    const hasSub = !!this.opts.sub;
    // with a second line the icon shrinks, so all three fit inside the round face
    if (hasIcon) {
      const iconY = this.opts.label ? (hasSub ? 0.25 : 0.34) : 0.5;
      drawIcon(ctx, this.opts.icon!, W / 2, W * iconY, W * (hasSub ? 0.26 : 0.36), accent);
    }
    if (this.opts.label) {
      ctx.fillStyle = PALETTE.ink;
      ctx.textAlign = 'center';
      let size = 104;
      ctx.font = `700 ${size}px ${FONT}`;
      let lines = wrap(ctx, this.opts.label, W * 0.78);
      while ((lines.length > 2 || lines.some((l) => ctx.measureText(l).width > W * 0.8)) && size > 56) {
        size -= 6;
        ctx.font = `700 ${size}px ${FONT}`;
        lines = wrap(ctx, this.opts.label, W * 0.78);
      }
      let y = hasIcon ? W * (hasSub ? 0.55 : 0.66) : W * 0.5 - ((lines.length - 1) * size * 1.05) / 2 + size * 0.35;
      for (const l of lines) {
        ctx.fillText(l, W / 2, y);
        y += size * 1.05;
      }
      if (this.opts.sub) {
        let sub = Math.round(size * 0.66);
        ctx.font = `700 ${sub}px ${FONT}`;
        while (ctx.measureText(this.opts.sub).width > W * 0.7 && sub > 40) {
          sub -= 3;
          ctx.font = `700 ${sub}px ${FONT}`;
        }
        ctx.fillStyle = PALETTE.muted;
        ctx.fillText(this.opts.sub, W / 2, y - size * 0.12);
      }
      ctx.textAlign = 'left';
    }
    texture.needsUpdate = true;
  }

  show(): void {
    this.visibleTarget = true;
    this.group.visible = true;
  }

  hide(): void {
    this.visibleTarget = false;
  }

  get shown(): boolean {
    return this.visibleTarget && this.appear > 0.6;
  }

  /** Top surface height above the group origin, including the press sink. */
  get topHeight(): number {
    return this.height - this.pressed * 0.006;
  }

  update(dt: number): void {
    const target = this.visibleTarget ? 1 : 0;
    this.appear += (target - this.appear) * (1 - Math.exp(-dt / 0.09));
    const s = Math.max(0.001, this.appear);
    this.group.scale.setScalar(s);
    this.group.visible = this.appear > 0.01;
    this.pressed = Math.max(0, this.pressed - dt * 3);
    this.body.position.y = -this.pressed * 0.006;
    this.face.position.y = this.height + 0.0006 - this.pressed * 0.006;
    const accent = new Color(this.opts.accent ?? PALETTE.understudy);
    const base = new Color('#f4efe6');
    const tint = this.selected ? 0.35 : this.hover * 0.18 + this.pressed * 0.4;
    this.bodyMat.color.copy(base).lerp(accent, tint);
    this.bodyMat.opacity = this.enabled ? 1 : 0.5;
    this.bodyMat.transparent = !this.enabled;
    this.ringMat.opacity = this.enabled ? Math.max(this.hover * 0.55, this.selected ? 0.9 : 0, this.dwell) : 0;
    this.ring.scale.setScalar(1 + this.dwell * 0.12);
  }
}
