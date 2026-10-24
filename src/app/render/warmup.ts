/**
 * Compiles every shader program the routine can draw, and uploads its
 * textures, at session start, while the user is still being placed at the
 * table. A headset compiles a program the first time an object using it is
 * drawn, and that frame stalls; here the work is spread over the first frames,
 * a few milliseconds each, before anything is on the mat. Rendering is
 * unchanged: the same materials, only compiled earlier.
 */
import {
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  Texture,
  WebGLRenderer,
} from '@iwsdk/core';
import { Stone } from '../ui/stone.js';
import type { Stage } from '../stage.js';

/**
 * Hidden stand-ins for objects created later in the session, with the same
 * material settings: stones (created per screen), the flower's double-sided
 * petals and the Playful style's instanced petal bursts. They are never drawn.
 */
function standIns(): Group {
  const g = new Group();
  g.name = 'shader-warmup';
  g.visible = false;
  g.add(new Stone({ id: 'warmup', label: '' }).group);
  const plane = new PlaneGeometry(0.01, 0.01);
  g.add(new Mesh(plane, new MeshStandardMaterial({ color: new Color('#ffffff'), roughness: 0.6, side: DoubleSide })));
  const bursts = new InstancedMesh(plane, new MeshBasicMaterial({ transparent: true, depthWrite: false, side: DoubleSide }), 1);
  bursts.setColorAt(0, new Color(1, 1, 1));
  g.add(bursts);
  return g;
}

const TEXTURE_KEYS = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'sheenColorMap', 'sheenRoughnessMap'] as const;

function materialsOf(o: Object3D): Material[] {
  const m = (o as Mesh).material as Material | Material[] | undefined;
  return m ? (Array.isArray(m) ? m : [m]) : [];
}

function texturesOf(root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  root.traverse((o) => {
    for (const mat of materialsOf(o)) {
      for (const key of TEXTURE_KEYS) {
        const t = (mat as unknown as Record<string, Texture | null | undefined>)[key];
        if (t && (t as Texture).isTexture) out.add(t);
      }
    }
  });
  return out;
}

export interface WarmUpResult {
  programs: number;
  textures: number;
  frames: number;
  ms: number;
}

/**
 * Create and step it inside XR frames, so programs are built for the
 * session's render target (multiview on Quest).
 */
export class ShaderWarmUp {
  private readonly queue: (() => void)[] = [];
  private readonly programsBefore: number;
  private readonly textureCount: number;
  private frames = 0;
  private spent = 0;
  result: WarmUpResult | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly camera: Camera,
    private readonly stage: Stage,
  ) {
    this.programsBefore = renderer.info.programs?.length ?? 0;
    const textures = texturesOf(scene);
    this.textureCount = textures.size;
    const library = standIns();
    stage.table.add(library);
    // Tracked, mirror and history hands switch between these during a
    // session. Each variant is compiled on one skinned hand, forearm included.
    const hand = stage.hands.history;
    for (const m of [stage.skin, stage.ghost, stage.leadGhost, stage.historyGhost, stage.occluder]) {
      this.queue.push(() => {
        const original = hand.getMaterial();
        hand.setMaterial(m);
        this.compile(hand.root);
        hand.setMaterial(original);
      });
    }
    // then every other drawable in the scene, once per material
    const seen = new Set<Material>();
    scene.traverse((o) => {
      const fresh = materialsOf(o).filter((m) => !seen.has(m));
      if (!fresh.length) return;
      for (const m of fresh) seen.add(m);
      this.queue.push(() => this.compile(o));
    });
    this.queue.push(() => library.removeFromParent());
    for (const t of textures) this.queue.push(() => renderer.initTexture(t));
  }

  private compile(o: Object3D): void {
    this.renderer.compile(o, this.camera, this.scene);
  }

  /** Runs queued work for up to `budgetMs`; true once everything has run. */
  step(budgetMs = 3): boolean {
    if (this.result) return true;
    const t0 = performance.now();
    // Programs depend on the lights in view. The key light rides on the table,
    // which stays hidden until the station is placed: show it for the
    // compile, within this task, so nothing is drawn in between.
    const table = this.stage.table;
    const shown = table.visible;
    table.visible = true;
    do this.queue.shift()?.();
    while (this.queue.length && performance.now() - t0 < budgetMs);
    table.visible = shown;
    this.frames++;
    this.spent += performance.now() - t0;
    if (this.queue.length) return false;
    this.result = {
      programs: (this.renderer.info.programs?.length ?? 0) - this.programsBefore,
      textures: this.textureCount,
      frames: this.frames,
      ms: Math.round(this.spent),
    };
    return true;
  }
}
