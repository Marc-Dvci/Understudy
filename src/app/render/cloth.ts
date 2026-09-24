/**
 * The virtual cloth. It settles over the resting Understudy hand and, being
 * opaque, hides the real hand in passthrough. Hand tracking keeps seeing the
 * hand underneath, so the app measures what the user no longer sees.
 */
import { BufferAttribute, Float32BufferAttribute, Group, Mesh, PlaneGeometry } from '@iwsdk/core';
import { rng } from '../../core/math.js';
import { makeCanvas } from '../ui/text.js';
import { makeClothMaterial } from './materials.js';

const LEN = 0.3;
const WID = 0.18;
const NX = 44;
const NZ = 64;

export class Cloth {
  readonly group = new Group();
  private readonly mesh: Mesh;
  private readonly base: Float32Array;
  private readonly draped: Float32Array;
  private settle = 0;
  private target = 0;
  /** Height of the drape over the hand, metres. */
  readonly bulge = 0.04;

  constructor() {
    const geo = new PlaneGeometry(WID, LEN, NX, NZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as BufferAttribute;
    this.base = new Float32Array(pos.array as Float32Array);
    this.draped = new Float32Array(pos.array.length);
    const r = rng(9);
    const wr: number[] = [];
    for (let i = 0; i < 12; i++) wr.push(r() * 6.28, 20 + r() * 40, (r() - 0.5) * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3];
      const z = this.base[i * 3 + 2];
      // the hand under the cloth: an ellipse, fuller over the palm (z > 0 is the wrist side)
      const ex = x / (WID * 0.34);
      const ez = (z + 0.01) / (LEN * 0.38);
      const d = Math.sqrt(ex * ex + ez * ez);
      const crown = this.bulge * smooth(Math.max(0, 1 - d) * 1.5);
      // fabric falls away from the hand in radial folds that deepen outward
      const ang = Math.atan2(z, x);
      const out = Math.max(0, d - 0.7);
      let folds = 0;
      for (let k = 0; k < 3; k++) folds += Math.sin(ang * (5 + k * 2) + wr[k * 3]) * (0.5 - k * 0.12);
      const skirt = this.bulge * 0.4 * Math.exp(-out * 2.6) * smooth(Math.min(1, d / 0.9));
      let y = Math.max(crown, skirt * (0.85 + 0.15 * folds));
      for (let k = 3; k < 6; k++) y += 0.0018 * Math.sin(wr[k * 3] + x * wr[k * 3 + 1] + z * wr[k * 3 + 1] * wr[k * 3 + 2]) * smooth(1 - out);
      // hem rests on the table
      const edge = Math.min(WID / 2 - Math.abs(x), LEN / 2 - Math.abs(z));
      y *= smooth(Math.min(1, edge / 0.035));
      this.draped[i * 3] = x;
      this.draped[i * 3 + 1] = Math.max(0.0015, y);
      this.draped[i * 3 + 2] = z;
    }
    // baked occlusion: folds and the hem sit darker than the crown of the drape
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = this.draped[i * 3 + 1];
      const k = 0.86 + 0.14 * Math.min(1, y / this.bulge + 0.2);
      colors[i * 3] = k;
      colors[i * 3 + 1] = k * 0.98;
      colors[i * 3 + 2] = k * 0.95;
    }
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const mat = makeClothMaterial();
    mat.vertexColors = true;
    // rounded, slightly uneven hem
    const hem = makeCanvas(128, 256);
    hem.ctx.fillStyle = '#000';
    hem.ctx.fillRect(0, 0, 128, 256);
    hem.ctx.fillStyle = '#fff';
    hem.ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const c = Math.cos(t);
      const s2 = Math.sin(t);
      const rr = 1 + 0.035 * Math.sin(t * 7 + 1) + 0.02 * Math.sin(t * 13);
      const px = 64 + Math.sign(c) * Math.pow(Math.abs(c), 0.55) * 60 * rr;
      const py = 128 + Math.sign(s2) * Math.pow(Math.abs(s2), 0.55) * 124 * rr;
      if (i === 0) hem.ctx.moveTo(px, py);
      else hem.ctx.lineTo(px, py);
    }
    hem.ctx.fill();
    hem.texture.needsUpdate = true;
    mat.alphaMap = hem.texture;
    mat.alphaTest = 0.5;
    mat.transparent = false;
    this.mesh = new Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.group.add(this.mesh);
    this.group.name = 'cloth';
    this.group.visible = false;
  }

  /** Places the cloth over a hand: centre on the table and the hand's forward direction. */
  place(cx: number, cy: number, cz: number, fx: number, fz: number): void {
    this.group.position.set(cx, cy, cz);
    this.group.rotation.set(0, Math.atan2(-fx, -fz), 0);
  }

  show(): void {
    this.target = 1;
    this.group.visible = true;
  }

  hide(): void {
    this.target = 0;
  }

  get settled(): boolean {
    return this.settle > 0.97;
  }

  update(dt: number): void {
    const prev = this.settle;
    if (this.target > this.settle) this.settle = Math.min(1, this.settle + dt / 0.9);
    else this.settle = Math.max(0, this.settle - dt / 0.4);
    this.group.visible = this.settle > 0.01;
    if (prev === this.settle) return;
    const pos = this.mesh.geometry.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    const t = this.settle;
    // falls from 14 cm, lands with a small overshoot
    const fall = 1 - easeOutBack(t);
    for (let i = 0; i < pos.count; i++) {
      const dy = this.draped[i * 3 + 1];
      arr[i * 3 + 1] = dy + fall * 0.14 * (1 - dy / this.bulge * 0.3);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    this.mesh.scale.setScalar(0.85 + 0.15 * t);
  }
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function easeOutBack(t: number): number {
  const c1 = 1.3;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
