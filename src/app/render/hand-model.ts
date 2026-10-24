/**
 * A skinned hand driven directly by a 25-joint pose.
 *
 * The WebXR generic hand model (MIT, webxr-input-profiles) keeps every joint
 * bone as a direct child of the armature, so a bone's local transform is the
 * joint pose itself when the model root sits at the world origin.
 */
import {
  AssetManager,
  CylinderGeometry,
  DataTexture,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RGBAFormat,
  SkinnedMesh,
  Vector3,
} from '@iwsdk/core';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Handedness, JOINT_COUNT, JOINT_NAMES, Pose } from '../../core/joints.js';

/** Alpha along the forearm: solid past the model's wrist cap (2 cm), gone by three quarters of its length. */
let fadeTexture: DataTexture | null = null;
function forearmFade(): DataTexture {
  if (fadeTexture) return fadeTexture;
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = Math.round(255 * Math.max(0, Math.min(1, 1 - (t - 0.25) / 0.5)) ** 1.5);
    data.set([a, a, a, 255], i * 4);
  }
  fadeTexture = new DataTexture(data, 1, n, RGBAFormat);
  fadeTexture.needsUpdate = true;
  return fadeTexture;
}

/**
 * A tapered, slightly flattened forearm from just inside the wrist toward
 * the elbow (+Z of the wrist joint). It hides the model's cut wrist and, as
 * an occluder, keeps the mat off the user's real forearm.
 */
function forearmGeometry(): CylinderGeometry {
  const length = 0.2;
  const g = new CylinderGeometry(0.031, 0.027, length, 28, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, length / 2 - 0.018);
  g.scale(1, 0.7, 1);
  return g;
}

export class HandModel {
  readonly root = new Group();
  readonly handedness: Handedness;
  private bones: (Object3D | undefined)[] = [];
  private meshes: Mesh[] = [];
  private loaded = false;
  private readonly m = new Matrix4();
  private readonly p = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private material: Material;
  private forearm: Mesh | null = null;
  private readonly fadedCopies = new Map<Material, Material>();
  private renderOrder = 2;
  scale = 1;

  constructor(handedness: Handedness, material: Material, name: string) {
    this.handedness = handedness;
    this.material = material;
    this.root.name = name;
    this.root.visible = false;
    this.root.matrixAutoUpdate = true;
  }

  async load(baseUrl: string): Promise<void> {
    const url = `${baseUrl}models/hand/${this.handedness}.glb`;
    // the asset manager caches one scene per URL; each hand needs its own
    // skeleton, so every model is a skinned clone of the cached scene
    const gltf = await AssetManager.loadGLTF(url, `hand-${this.handedness}`);
    const scene = cloneSkinned(gltf.scene) as Group;
    this.bones = JOINT_NAMES.map((n) => scene.getObjectByName(n) ?? undefined);
    scene.traverse((o) => {
      // Imported model transforms are static; joint matrices are written in
      // apply(). Hidden skeletons no longer recompose 25 bones every frame.
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      if ((o as Mesh).isMesh) {
        const mesh = o as Mesh;
        mesh.material = this.material;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = this.renderOrder;
        this.meshes.push(mesh);
      }
    });
    const wrist = this.bones[0];
    if (wrist) {
      this.forearm = new Mesh(forearmGeometry(), this.forearmMaterial(this.material));
      this.forearm.frustumCulled = false;
      this.forearm.renderOrder = this.renderOrder;
      this.forearm.updateMatrix();
      this.forearm.matrixAutoUpdate = false;
      wrist.add(this.forearm);
    }
    this.root.add(scene);
    this.loaded = true;
  }

  /** The hand's material with the forearm fade; depth-only materials stay as they are. */
  private forearmMaterial(source: Material): Material {
    if (!source.colorWrite) return source;
    let copy = this.fadedCopies.get(source);
    if (!copy) {
      copy = source.clone();
      const faded = copy as MeshBasicMaterial;
      faded.alphaMap = forearmFade();
      faded.transparent = true;
      faded.depthWrite = false;
      copy.onBeforeCompile = source.onBeforeCompile;
      const key = source.customProgramCacheKey();
      copy.customProgramCacheKey = () => `${key}-forearm`;
      this.fadedCopies.set(source, copy);
    }
    // follow tone and shader changes made to the shared hand material
    const src = source as MeshBasicMaterial & { sheen?: number; clearcoat?: number };
    const dst = copy as MeshBasicMaterial & { sheen?: number; clearcoat?: number };
    if (src.color && !dst.color.equals(src.color)) dst.color.copy(src.color);
    dst.opacity = src.opacity;
    if (src.sheen !== undefined && (dst.sheen !== src.sheen || dst.clearcoat !== src.clearcoat)) {
      dst.sheen = src.sheen;
      dst.clearcoat = src.clearcoat;
      dst.needsUpdate = true;
    }
    return copy;
  }

  get ready(): boolean {
    return this.loaded;
  }

  getMaterial(): Material {
    return this.material;
  }

  setMaterial(material: Material): void {
    if (material === this.material) return;
    this.material = material;
    for (const mesh of this.meshes) mesh.material = material;
    if (this.forearm) this.forearm.material = this.forearmMaterial(material);
  }

  setVisible(v: boolean): void {
    this.root.visible = v && this.loaded;
  }

  setRenderOrder(order: number): void {
    if (order === this.renderOrder) return;
    this.renderOrder = order;
    for (const mesh of this.meshes) mesh.renderOrder = order;
    if (this.forearm) this.forearm.renderOrder = order;
  }

  /** Writes joint poses to bones. `scale` shrinks or grows the hand about the wrist. */
  apply(pose: Pose): void {
    if (!this.loaded) return;
    // Mirror/history hands also follow Settings changes to shared materials;
    // their forearms must not retain the tone from the initial load.
    if (this.forearm) this.forearmMaterial(this.material);
    const wx = pose[12];
    const wy = pose[13];
    const wz = pose[14];
    const k = this.scale;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const bone = this.bones[j];
      if (!bone) continue;
      this.m.fromArray(pose, j * 16);
      this.m.decompose(this.p, this.q, this.s);
      if (k !== 1) {
        this.p.set(wx + (this.p.x - wx) * k, wy + (this.p.y - wy) * k, wz + (this.p.z - wz) * k);
      }
      bone.position.copy(this.p);
      bone.quaternion.copy(this.q);
      bone.updateMatrix();
    }
  }

  isSkinned(): boolean {
    return this.meshes.some((m) => (m as SkinnedMesh).isSkinnedMesh);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.forearm?.geometry.dispose();
    for (const material of this.fadedCopies.values()) material.dispose();
    this.fadedCopies.clear();
    const skeletons = new Set(this.meshes.filter((mesh) => (mesh as SkinnedMesh).isSkinnedMesh).map((mesh) => (mesh as SkinnedMesh).skeleton));
    for (const skeleton of skeletons) skeleton.dispose();
    this.loaded = false;
  }
}
