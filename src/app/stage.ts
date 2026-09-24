/**
 * Everything drawn on and above the table, positioned from the station each
 * frame: the mat, the cloth, the instruction card, the board, the stones and
 * the hands.
 */
import { AmbientLight, createSystem, DirectionalLight, Group, Vector3 } from '@iwsdk/core';
import { J } from '../core/joints.js';
import { sound } from './audio.js';
import { Cloth } from './render/cloth.js';
import { HandModel } from './render/hand-model.js';
import { Mat, MAT_D, MAT_W } from './render/mat.js';
import { makeGhostMaterial, makeSkinMaterial, PALETTE } from './render/materials.js';
import { leadHand, state, understudyHand } from './state.js';
import { Card } from './ui/card.js';
import { CanvasPanel } from './ui/panel.js';
import { PressInput } from './ui/press.js';
import { Stone, StoneOptions } from './ui/stone.js';

export type TrackedHandStyle = 'skin' | 'ghost' | 'hidden';

export class Stage {
  readonly root = new Group();
  readonly table = new Group();
  readonly mat = new Mat();
  readonly cloth = new Cloth();
  readonly card = new Card(0.4, 0.2, 'instruction-card');
  readonly board = new CanvasPanel(0.5, 0.24, 2600, 'board');
  /** A small standing panel at the back corner on the Understudy side. */
  readonly meter = new CanvasPanel(0.24, 0.11, 2600, 'meter');
  readonly press = new PressInput();
  readonly skin = makeSkinMaterial(2);
  readonly ghost = makeGhostMaterial('#cfe6ff', 0.3);
  readonly leadGhost = makeGhostMaterial('#ffe2b8', 0.22);
  hands!: {
    left: HandModel;
    right: HandModel;
    mirror: HandModel;
    history: HandModel;
    demoLeft: HandModel;
    demoRight: HandModel;
  };
  trackedStyle: TrackedHandStyle = 'hidden';
  cardSlot: 'back' | 'high' = 'back';
  /** Extra lift of the mirrored hand, e.g. to rest on top of the cloth. */
  mirrorLift = 0;
  private readonly tmp = new Vector3();

  constructor() {
    this.root.name = 'understudy-stage';
    this.table.name = 'station';
    this.root.add(this.table);
    this.table.add(this.mat.group);
    this.table.add(this.board.group);
    this.table.add(this.meter.group);
    this.table.add(this.card.group);
    this.root.add(this.cloth.group);
    // a soft key light from above and behind the user's left shoulder gives
    // the cloth, stones and hands their shape; the IBL supplies the fill
    this.key.position.set(-0.5, 1.4, 0.8);
    this.key.target = this.table;
    this.table.add(this.key);
    this.root.add(this.fill);
  }

  private readonly key = new DirectionalLight(0xfff2e2, 0.95);
  private readonly fill = new AmbientLight(0xf4efe8, 0.12);

  async loadHands(base: string): Promise<void> {
    this.hands = {
      left: new HandModel('left', this.skin, 'hand-left'),
      right: new HandModel('right', this.skin, 'hand-right'),
      mirror: new HandModel(understudyHand(), this.skin, 'hand-mirror'),
      history: new HandModel(understudyHand(), this.ghost, 'hand-history'),
      demoLeft: new HandModel('left', this.skin, 'hand-demo-left'),
      demoRight: new HandModel('right', this.skin, 'hand-demo-right'),
    };
    await Promise.all(Object.values(this.hands).map((h) => h.load(base)));
    for (const h of Object.values(this.hands)) this.root.add(h.root);
    this.hands.mirror.setRenderOrder(3);
  }

  /** Recreates the mirror and history hands when the Understudy side changes. */
  async setUnderstudySide(base: string): Promise<void> {
    const side = understudyHand();
    if (this.hands.mirror.handedness === side) return;
    for (const key of ['mirror', 'history'] as const) {
      const old = this.hands[key];
      this.root.remove(old.root);
      const next = new HandModel(side, key === 'mirror' ? this.skin : this.ghost, `hand-${key}`);
      await next.load(base);
      this.root.add(next.root);
      this.hands[key] = next;
    }
    this.hands.mirror.setRenderOrder(3);
  }

  stone(opts: StoneOptions): Stone {
    const existing = this.press.get(opts.id);
    if (existing) {
      existing.setLabel(opts.label, opts.sub, opts.icon);
      return existing;
    }
    const s = new Stone(opts);
    this.table.add(s.group);
    return this.press.add(s);
  }

  /**
   * Places stones in a row near the far edge of the mat. With neglect support
   * on, the row stays on the attended side.
   */
  layoutStones(ids: string[], row: 'far' | 'near' | 'mid' = 'far'): void {
    const n = ids.length;
    const keep = state.profile.keepSide;
    const span = keep === 'none' ? MAT_W - 0.12 : MAT_W / 2 - 0.05;
    const center = keep === 'none' ? 0 : keep === 'right' ? MAT_W / 4 : -MAT_W / 4;
    const gap = n > 1 ? Math.min(0.13, span / (n - 1)) : 0;
    const v = row === 'far' ? 0.15 : row === 'mid' ? 0.055 : -0.15;
    ids.forEach((id, i) => {
      const s = this.press.get(id);
      if (!s) return;
      const u = center + (i - (n - 1) / 2) * gap;
      s.group.position.set(u, 0.0015, -v);
      s.show();
    });
  }

  hideStones(): void {
    this.press.hideAll();
  }

  /** Station-local (u right, v away, h up) to world. */
  toWorld(u: number, v: number, h: number, out = new Vector3()): Vector3 {
    out.set(u, h, -v);
    this.table.localToWorld(out);
    return out;
  }

  update(dt: number, camera: { position: Vector3; getWorldPosition(v: Vector3): Vector3 }): void {
    const s = state.station;
    this.table.visible = s.ready;
    if (s.ready) {
      this.table.position.set(s.center[0], s.center[1], s.center[2]);
      this.table.rotation.set(0, Math.atan2(-s.forward[0], -s.forward[2]), 0);
      this.table.updateMatrixWorld(true);
    }
    // the card stands behind the mat and leans back, facing the user
    const keep = state.profile.keepSide;
    const cu = keep === 'none' ? 0 : keep === 'right' ? 0.14 : -0.14;
    // Before the table exists the flow floats the card ahead of the user.
    // Once on the table it stands low behind the mat and leans back, so it
    // stays inside the Meta VR Glasses view (25 degrees up) of the mat. With
    // the meter up, the card steps away from it.
    if (this.card.group.parent === this.table) {
      const cardShift = this.meter.target > 0 ? -(understudyHand() === 'left' ? -1 : 1) * 0.07 : 0;
      this.card.group.position.set(cu + cardShift, 0.058, -(MAT_D / 2 + 0.015));
      this.card.group.rotation.set(-0.72, 0, 0);
    }
    this.board.group.position.set(cu, 0.07, -(MAT_D / 2 + 0.02));
    this.board.group.rotation.set(-0.7, 0, 0);

    this.mat.update(dt);
    this.cloth.update(dt);
    this.card.update(dt);
    const uSide = understudyHand() === 'left' ? -1 : 1;
    this.meter.group.position.set(uSide * 0.31, 0.07, -(MAT_D / 2 + 0.02));
    this.meter.group.rotation.set(-0.4, -uSide * 0.35, 0, 'YXZ');
    this.card.suppressed = this.board.target > 0;
    this.board.update(dt);
    this.meter.update(dt);
    this.press.update(dt);
    this.updateHands();

    camera.getWorldPosition(this.tmp);
    sound.setListener(this.tmp.x, this.tmp.y, this.tmp.z, state.headForward[0], -0.5, state.headForward[2], 0, 1, 0);
  }

  private updateHands(): void {
    if (!this.hands) return;
    const style = this.trackedStyle;
    for (const side of ['left', 'right'] as const) {
      const model = this.hands[side];
      const t = state.hands[side];
      const hiddenUnderCloth = state.mirror.cloth && side === understudyHand();
      const show = style !== 'hidden' && t.lostFor < 0.3 && !hiddenUnderCloth;
      model.setVisible(show);
      if (show) {
        model.setMaterial(style === 'skin' ? this.skin : side === leadHand() ? this.leadGhost : this.ghost);
        model.apply(t.pose);
      }
    }
    const m = state.mirror;
    const mirrorModel = this.hands.mirror;
    mirrorModel.setVisible(m.visibility > 0.02);
    if (m.visibility > 0.02) {
      if (this.mirrorLift !== 0) {
        for (let j = 0; j < 25; j++) m.renderPose[j * 16 + 13] += this.mirrorLift;
      }
      mirrorModel.apply(m.renderPose);
      if (this.mirrorLift !== 0) {
        for (let j = 0; j < 25; j++) m.renderPose[j * 16 + 13] -= this.mirrorLift;
      }
      mirrorModel.root.scale.setScalar(0.94 + 0.06 * m.visibility);
    }
  }

  /** World position of the mirrored index fingertip, for spatial taps. */
  mirrorTip(out: Float64Array): Float64Array {
    const p = state.mirror.renderPose;
    out[0] = p[J.indexTip * 16 + 12];
    out[1] = p[J.indexTip * 16 + 13] + this.mirrorLift;
    out[2] = p[J.indexTip * 16 + 14];
    return out;
  }
}

export const stage = new Stage();

/** Runs the stage every frame. */
export class StageSystem extends createSystem({}) {
  update(delta: number): void {
    const adapters = this.world.input.xr.visualAdapters.hand;
    adapters.left.toggleVisual(false);
    adapters.right.toggleVisual(false);
    stage.press.camera = this.world.camera;
    stage.update(delta, this.world.camera);
  }
}

export { PALETTE };
