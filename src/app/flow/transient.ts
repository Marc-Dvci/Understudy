import { BufferGeometry, Material, Mesh, Object3D } from '@iwsdk/core';

/** Dispose exercise-owned resources once, including geometry shared within a group. */
export function disposeTransient(...objects: Object3D[]): void {
  const geometry = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  for (const object of objects) {
    object.removeFromParent();
    object.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      geometry.add(child.geometry);
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material);
    });
  }
  for (const g of geometry) g.dispose();
  for (const m of materials) m.dispose();
}
