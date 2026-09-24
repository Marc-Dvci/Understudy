/**
 * A skinned hand driven directly by a 25-joint pose.
 *
 * The WebXR generic hand model (MIT, webxr-input-profiles) keeps every joint
 * bone as a direct child of the armature, so a bone's local transform is the
 * joint pose itself when the model root sits at the world origin.
 */
import { AssetManager, Group, Material, Matrix4, Mesh, Object3D, Quaternion, SkinnedMesh, Vector3 } from '@iwsdk/core';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Handedness, JOINT_COUNT, JOINT_NAMES, Pose } from '../../core/joints.js';

let counter = 0;

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
    counter++;
    this.bones = JOINT_NAMES.map((n) => scene.getObjectByName(n) ?? undefined);
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) {
        const mesh = o as Mesh;
        mesh.material = this.material;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.renderOrder = 2;
        this.meshes.push(mesh);
      }
    });
    this.root.add(scene);
    this.loaded = true;
  }

  get ready(): boolean {
    return this.loaded;
  }

  setMaterial(material: Material): void {
    this.material = material;
    for (const mesh of this.meshes) mesh.material = material;
  }

  setVisible(v: boolean): void {
    this.root.visible = v && this.loaded;
  }

  setRenderOrder(order: number): void {
    for (const mesh of this.meshes) mesh.renderOrder = order;
  }

  /** Writes joint poses to bones. `scale` shrinks or grows the hand about the wrist. */
  apply(pose: Pose): void {
    if (!this.loaded) return;
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
    }
  }

  isSkinned(): boolean {
    return this.meshes.some((m) => (m as SkinnedMesh).isSkinnedMesh);
  }
}
