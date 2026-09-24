/**
 * A canvas-backed plane for drawn content: charts, meters, labels. Redraws
 * only when its draw function reports a change.
 */
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from '@iwsdk/core';
import { makeCanvas } from './text.js';

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

export class CanvasPanel {
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly c: ReturnType<typeof makeCanvas>;
  private drawFn: DrawFn | null = null;
  private animUntil = 0;
  private t = 0;
  opacity = 0;
  target = 0;

  constructor(width: number, height: number, pxPerM = 2400, name = 'panel') {
    this.c = makeCanvas(Math.round(width * pxPerM), Math.round(height * pxPerM));
    this.mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: this.c.texture, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
    );
    this.mesh.renderOrder = 4;
    this.group.add(this.mesh);
    this.group.name = name;
    this.group.visible = false;
  }

  /** Lays the panel flat on the table (face up). */
  flat(): this {
    this.mesh.rotation.x = -Math.PI / 2;
    return this;
  }

  /**
   * Sets the drawing. `animate` seconds of per-frame redraws follow, so the
   * function can animate on `t` (seconds since set).
   */
  draw(fn: DrawFn, animate = 0): void {
    this.drawFn = fn;
    this.t = 0;
    this.animUntil = animate;
    this.redraw();
  }

  redraw(): void {
    if (!this.drawFn) return;
    const { ctx, canvas, texture } = this.c;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFn(ctx, canvas.width, canvas.height, this.t);
    texture.needsUpdate = true;
  }

  show(): void {
    this.target = 1;
    this.group.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  update(dt: number): void {
    this.opacity += (this.target - this.opacity) * (1 - Math.exp(-dt / 0.15));
    (this.mesh.material as MeshBasicMaterial).opacity = this.opacity;
    this.group.visible = this.opacity > 0.01;
    if (this.t < this.animUntil) {
      this.t += dt;
      this.redraw();
    }
  }
}
