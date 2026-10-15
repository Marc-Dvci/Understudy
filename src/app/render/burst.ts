/**
 * Playful presentation: when a repetition completes, a small burst of petals
 * rises from a point on the table, drifts and fades. One InstancedMesh draws
 * every petal, so a burst costs one draw call however many petals are alive,
 * and update() allocates nothing. There are no points or scores here; the
 * burst is only a celebration.
 */
import {
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from '@iwsdk/core';
import { disposeTransient } from '../flow/transient.js';

/** Petal outline, copied from the flower in flow/exercises.ts (base at y 0, tip at y 0.05). */
function petalShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.012, 0.012, 0.014, 0.034, 0, 0.05);
  s.bezierCurveTo(-0.014, 0.034, -0.012, 0.012, 0, 0);
  return s;
}

/** Outline length in metres before scaling, and the length a petal should be on the table. */
const OUTLINE_LENGTH = 0.05;
const PETAL_LENGTH = 0.03;
const GRAVITY = 0.5;
/** Petals shrink to nothing over the last 30% of their life. */
const SHRINK_START = 0.7;
const DEFAULT_COUNT = 9;
const DEFAULT_CAPACITY = 48;
/** Warm pink, gold and sky blue, matching the flower colours in exercises.ts. */
const DEFAULT_COLORS = ['#f19bb5', '#f6c945', '#9bc4f1'];
const SEED = 0x5e7a1;

/** Small seeded PRNG (mulberry32), so bursts are reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PetalBursts {
  private readonly mesh: InstancedMesh;
  private readonly capacity: number;
  private readonly rand: () => number;
  private readonly colorCache = new Map<string, Color>();
  private colorCursor = 0;
  private live = 0;

  // Per-petal state, one slot per instance. Vector data uses stride 3 (or 2 for spin).
  private readonly alive: Uint8Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  /** Base Euler angles x, y, z at emit. */
  private readonly rot: Float32Array;
  /** Spin rates about x and y, rad/s. */
  private readonly spin: Float32Array;

  // Scratch objects, reused so update() never allocates.
  private readonly matrix = new Matrix4();
  private readonly hidden = new Matrix4().makeScale(0, 0, 0);
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();
  private readonly euler = new Euler();

  /** `parent` is the station group (table-local frame: x right, y up, -z away). */
  constructor(parent: Object3D, options: { maxPetals?: number } = {}) {
    const n = Math.max(1, Math.floor(options.maxPetals ?? DEFAULT_CAPACITY));
    this.capacity = n;
    this.rand = mulberry32(SEED);
    this.alive = new Uint8Array(n);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.spin = new Float32Array(n * 2);

    // Shared geometry: the outline scaled to about 3 cm and centred on its origin.
    const geometry = new ShapeGeometry(petalShape(), 10);
    const s = PETAL_LENGTH / OUTLINE_LENGTH;
    geometry.scale(s, s, s);
    geometry.translate(0, -PETAL_LENGTH / 2, 0);
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide });

    this.mesh = new InstancedMesh(geometry, material, n);
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
    // after the instruction card (10), which writes no depth and would paint over petals in front of it
    this.mesh.renderOrder = 11;
    // Create the instance colour buffer now, so the material never recompiles mid-burst.
    const white = new Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setColorAt(i, white);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    parent.add(this.mesh);
  }

  /** Emits `count` petals from a table-local point. Colours cycle through `colors`. */
  burst(x: number, y: number, z: number, count = DEFAULT_COUNT, colors: string[] = DEFAULT_COLORS): void {
    if (count <= 0) return;
    const palette = colors.length > 0 ? colors : DEFAULT_COLORS;
    const r = this.rand;
    for (let n = 0; n < count; n++) {
      const i = this.claimSlot();
      if (!this.alive[i]) {
        this.alive[i] = 1;
        this.live++;
      }
      const v = i * 3;
      const sp = i * 2;
      this.age[i] = 0;
      this.life[i] = 1.1 + 0.5 * r();
      this.pos[v] = x + 0.02 * (r() - 0.5);
      this.pos[v + 1] = y + 0.004 * r();
      this.pos[v + 2] = z + 0.02 * (r() - 0.5);
      const heading = 2 * Math.PI * r();
      const drift = 0.05 + 0.1 * r();
      this.vel[v] = Math.cos(heading) * drift;
      this.vel[v + 1] = 0.25 + 0.2 * r();
      this.vel[v + 2] = Math.sin(heading) * drift;
      this.rot[v] = 2 * Math.PI * r();
      this.rot[v + 1] = 2 * Math.PI * r();
      this.rot[v + 2] = 2 * Math.PI * r();
      this.spin[sp] = 2.4 * (r() - 0.5);
      this.spin[sp + 1] = 2.4 * (r() - 0.5);
      this.place(i);
      this.mesh.setColorAt(i, this.colorFor(palette[this.colorCursor % palette.length]));
      this.colorCursor = (this.colorCursor + 1) % palette.length;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Advances the animation; call every frame with seconds. */
  update(dt: number): void {
    if (this.live === 0) return;
    let changed = false;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      changed = true;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.alive[i] = 0;
        this.live--;
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      const v = i * 3;
      this.vel[v + 1] -= GRAVITY * dt;
      this.pos[v] += this.vel[v] * dt;
      this.pos[v + 1] += this.vel[v + 1] * dt;
      this.pos[v + 2] += this.vel[v + 2] * dt;
      this.place(i);
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Live petal count, for tests. */
  get active(): number {
    return this.live;
  }

  dispose(): void {
    disposeTransient(this.mesh);
    this.alive.fill(0);
    this.live = 0;
  }

  /** A free slot if there is one, otherwise the oldest live petal. */
  private claimSlot(): number {
    for (let i = 0; i < this.capacity; i++) if (!this.alive[i]) return i;
    let oldest = 0;
    for (let i = 1; i < this.capacity; i++) if (this.age[i] > this.age[oldest]) oldest = i;
    return oldest;
  }

  /** Writes petal i's matrix: its position, spin about two axes, and the shrink over the last 30% of life. */
  private place(i: number): void {
    const t = this.age[i];
    const f = t / this.life[i];
    const k = f > SHRINK_START ? Math.max(0, (1 - f) / (1 - SHRINK_START)) : 1;
    const v = i * 3;
    const sp = i * 2;
    this.position.set(this.pos[v], this.pos[v + 1], this.pos[v + 2]);
    this.euler.set(this.rot[v] + this.spin[sp] * t, this.rot[v + 1] + this.spin[sp + 1] * t, this.rot[v + 2]);
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(k, k, k);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(i, this.matrix);
  }

  private colorFor(hex: string): Color {
    let c = this.colorCache.get(hex);
    if (!c) {
      c = new Color(hex);
      this.colorCache.set(hex, c);
    }
    return c;
  }
}
