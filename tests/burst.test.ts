import { describe, expect, it } from 'vitest';
import { InstancedMesh, Matrix4, Object3D } from '@iwsdk/core';
import { PetalBursts } from '../src/app/render/burst.js';

const EMIT = { x: 0, y: 0.9, z: -0.1 };

function petalMeshOf(parent: Object3D): InstancedMesh {
  const mesh = parent.children.find((c): c is InstancedMesh => c instanceof InstancedMesh);
  if (!mesh) throw new Error('no petal mesh under the parent');
  return mesh;
}

describe('PetalBursts', () => {
  it('a burst of nine gives nine live petals', () => {
    const bursts = new PetalBursts(new Object3D());
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 9);
    expect(bursts.active).toBe(9);
  });

  it('every petal is gone after two seconds of 0.1 s steps', () => {
    const bursts = new PetalBursts(new Object3D());
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 9);
    for (let i = 0; i < 20; i++) bursts.update(0.1);
    expect(bursts.active).toBe(0);
  });

  it('never holds more than maxPetals, even when a burst overflows it', () => {
    const bursts = new PetalBursts(new Object3D(), { maxPetals: 12 });
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 9);
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 9);
    expect(bursts.active).toBeLessThanOrEqual(12);
    expect(bursts.active).toBe(12);
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 30);
    expect(bursts.active).toBe(12);
  });

  it('when full, a new burst recycles the oldest petal rather than the newest', () => {
    const parent = new Object3D();
    const bursts = new PetalBursts(parent, { maxPetals: 2 });
    bursts.burst(0, EMIT.y, EMIT.z, 1);
    bursts.update(0.5);
    bursts.burst(0.2, EMIT.y, EMIT.z, 1);
    bursts.update(0.1);
    bursts.burst(0.4, EMIT.y, EMIT.z, 1);
    expect(bursts.active).toBe(2);
    const mesh = petalMeshOf(parent);
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    expect(m.elements[12]).toBeCloseTo(0.4, 1);
    mesh.getMatrixAt(1, m);
    expect(m.elements[12]).toBeCloseTo(0.2, 1);
  });

  it('mid-life petals sit above the emit point', () => {
    const parent = new Object3D();
    const bursts = new PetalBursts(parent);
    bursts.burst(EMIT.x, EMIT.y, EMIT.z, 9);
    for (let i = 0; i < 6; i++) bursts.update(0.1);
    const mesh = petalMeshOf(parent);
    const m = new Matrix4();
    let live = 0;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      if (Math.abs(m.determinant()) < 1e-9) continue;
      live++;
      expect(m.elements[13]).toBeGreaterThan(EMIT.y);
    }
    expect(live).toBe(9);
    expect(bursts.active).toBe(9);
  });

  it('dispose detaches the mesh from its parent', () => {
    const parent = new Object3D();
    const bursts = new PetalBursts(parent);
    expect(parent.children.length).toBe(1);
    bursts.dispose();
    expect(parent.children.length).toBe(0);
  });
});
