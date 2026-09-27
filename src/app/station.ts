/**
 * Finds the table and fixes the station on it.
 *
 * Order of evidence:
 *  1. a detected plane labelled `table` within reach, below eye height;
 *  2. a detected mesh labelled `table`;
 *  3. the user's own flat hand: resting fingertips mark the surface;
 *  4. the same on the lap, with a smaller mat.
 * Once set, a persistent anchor lets tomorrow's session find the same place.
 */
import { createSystem } from '@iwsdk/core';
import { Handedness, J } from '../core/joints.js';
import { clamp, dot3, v3 } from '../core/math.js';
import { state, TrackedHand } from './state.js';

const ANCHOR_KEY = 'understudy.station.anchor';
const FLAT_SECONDS = 0.8;
const TIP_RADIUS = 0.008;

type Listener = () => void;

export class StationSystem extends createSystem({}) {
  private stillFor: Record<Handedness, number> = { left: 0, right: 0 };
  private lastWrist: Record<Handedness, Float64Array> = { left: v3(), right: v3() };
  private anchor: XRAnchor | null = null;
  private anchorRequested = false;
  private restoreTried = false;
  /** Seconds a restored anchor has had to report a pose that passes the checks. */
  private restoreWait = -1;
  private readonly listeners: Listener[] = [];
  private readonly tmp = v3();
  searching = false;
  /** Test switch: behave as in a room without Space Setup. */
  ignoreLabels = false;
  /** Seconds spent searching, for the prompt to escalate to the fallback. */
  searchTime = 0;

  onReady(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Starts a fresh search, discarding the current station. */
  search(): void {
    state.station.ready = false;
    state.station.source = 'none';
    this.searching = true;
    this.searchTime = 0;
    this.stillFor.left = 0;
    this.stillFor.right = 0;
  }

  update(delta: number): void {
    const frame = this.world.renderer.xr.getFrame() as XRFrame | null;
    const ref = this.world.renderer.xr.getReferenceSpace();

    if (state.station.ready && this.anchor && frame && ref) {
      const pose = frame.getPose(this.anchor.anchorSpace, ref);
      if (pose) this.applyPose(pose.transform.matrix);
    }
    if (!this.searching) return;
    this.searchTime += delta;

    if (frame && ref && !this.restoreTried) {
      this.restoreTried = true;
      void this.restoreAnchor(frame);
    }
    // yesterday's anchor is used only if it is still a table in reach: the
    // user may have moved to another room, or the headset lost its map
    if (this.restoreWait >= 0 && this.anchor && frame && ref) {
      this.restoreWait += delta;
      const pose = frame.getPose(this.anchor.anchorSpace, ref);
      if (pose && this.acceptRestored(pose.transform.matrix)) {
        this.restoreWait = -1;
        this.applyPose(pose.transform.matrix);
        state.station.source = 'table-label';
        state.station.anchored = true;
        state.station.ready = true;
        this.searching = false;
        for (const fn of this.listeners) fn();
        return;
      }
      if (this.restoreWait > 2.5) this.discardRestored();
      else return;
    }

    // track stillness of flat hands
    for (const h of ['left', 'right'] as Handedness[]) this.trackStill(state.hands[h], delta);

    const tableFromPlanes = frame && ref && !this.ignoreLabels ? this.findLabelledTable(frame, ref) : null;
    const flat = this.flatHandSurface();

    if (tableFromPlanes && (flat !== null || this.searchTime > 1.5 || !this.anyHandTracked())) {
      // prefer the labelled table, but let resting hands choose the centre
      this.establish(tableFromPlanes.height, tableFromPlanes.source, tableFromPlanes.width, tableFromPlanes.depth);
      return;
    }
    if (flat !== null) {
      const lap = !tableFromPlanes && flat < 0.62;
      this.establish(flat, lap ? 'lap' : 'flat-hand', 0, 0);
    }
  }

  private anyHandTracked(): boolean {
    return state.hands.left.valid || state.hands.right.valid;
  }

  private trackStill(hand: TrackedHand, dt: number): void {
    const w = hand.pose;
    const lw = this.lastWrist[hand.handedness];
    if (!hand.valid) {
      this.stillFor[hand.handedness] = 0;
      return;
    }
    const d = Math.hypot(w[12] - lw[0], w[13] - lw[1], w[14] - lw[2]);
    lw[0] = w[12];
    lw[1] = w[13];
    lw[2] = w[14];
    const palmDown = dot3(hand.kin.dorsal, state.station.up) > 0.75;
    const open = hand.kin.opening > 0.45;
    if (palmDown && open && d / Math.max(dt, 1e-3) < 0.04) this.stillFor[hand.handedness] += dt;
    else this.stillFor[hand.handedness] = 0;
  }

  /** Height of the surface under resting fingertips, or null. */
  private flatHandSurface(): number | null {
    const heights: number[] = [];
    for (const h of ['left', 'right'] as Handedness[]) {
      const hand = state.hands[h];
      if (this.stillFor[h] < FLAT_SECONDS) continue;
      let min = Infinity;
      for (const j of [J.indexTip, J.middleTip, J.ringTip, J.pinkyTip]) min = Math.min(min, hand.pose[j * 16 + 13]);
      heights.push(min - TIP_RADIUS);
    }
    if (heights.length === 0) return null;
    return heights.reduce((a, b) => a + b, 0) / heights.length;
  }

  private findLabelledTable(
    frame: XRFrame,
    ref: XRReferenceSpace,
  ): { height: number; source: 'table-label' | 'mesh-label'; width: number; depth: number } | null {
    const head = state.head;
    let best: { height: number; source: 'table-label' | 'mesh-label'; width: number; depth: number; d: number } | null = null;
    const consider = (space: XRSpace, source: 'table-label' | 'mesh-label', width: number, depth: number, top: number) => {
      const pose = frame.getPose(space, ref);
      if (!pose) return;
      this.player.updateWorldMatrix(true, false);
      const pm = this.player.matrixWorld.elements;
      const p = pose.transform.position;
      const wx = pm[0] * p.x + pm[4] * p.y + pm[8] * p.z + pm[12];
      const wy = pm[1] * p.x + pm[5] * p.y + pm[9] * p.z + pm[13] + top;
      const wz = pm[2] * p.x + pm[6] * p.y + pm[10] * p.z + pm[14];
      if (wy < 0.3 || wy > head[1] - 0.15) return;
      const d = Math.hypot(wx - head[0], wz - head[2]);
      if (d > 1.6) return;
      if (!best || d < best.d) best = { height: wy, source, width, depth, d };
    };
    const planes = (frame as XRFrame & { detectedPlanes?: Set<XRPlane> }).detectedPlanes;
    planes?.forEach((plane) => {
      const label = ((plane as XRPlane & { semanticLabel?: string }).semanticLabel ?? '').toLowerCase();
      if (label !== 'table' || plane.orientation !== 'horizontal') return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const v of plane.polygon) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
      }
      consider(plane.planeSpace, 'table-label', maxX - minX, maxZ - minZ, 0);
    });
    if (best) return best;
    const meshes = (frame as XRFrame & { detectedMeshes?: Set<XRMesh & { semanticLabel?: string }> }).detectedMeshes;
    meshes?.forEach((mesh) => {
      if ((mesh.semanticLabel ?? '').toLowerCase() !== 'table') return;
      let maxY = -Infinity;
      const v = mesh.vertices;
      for (let i = 1; i < v.length; i += 3) maxY = Math.max(maxY, v[i]);
      consider(mesh.meshSpace, 'mesh-label', 0, 0, Number.isFinite(maxY) ? maxY : 0);
    });
    return best;
  }

  private establish(height: number, source: typeof state.station.source, width: number, depth: number): void {
    const s = state.station;
    const fwd = state.headForward;
    s.forward[0] = fwd[0];
    s.forward[1] = 0;
    s.forward[2] = fwd[2];
    // right = forward x up
    s.right[0] = -fwd[2];
    s.right[1] = 0;
    s.right[2] = fwd[0];
    s.height = height;
    // centre between the resting hands when both are visible, else 38 cm ahead
    const L = state.hands.left;
    const R = state.hands.right;
    let cx: number;
    let cz: number;
    if (L.valid && R.valid) {
      cx = (L.pose[J.middleProx * 16 + 12] + R.pose[J.middleProx * 16 + 12]) / 2;
      cz = (L.pose[J.middleProx * 16 + 14] + R.pose[J.middleProx * 16 + 14]) / 2;
    } else {
      cx = state.head[0] + fwd[0] * 0.38;
      cz = state.head[2] + fwd[2] * 0.38;
    }
    // keep the mat within comfortable reach: 28 to 48 cm ahead of the head
    const along = (cx - state.head[0]) * fwd[0] + (cz - state.head[2]) * fwd[2];
    const clamped = clamp(along, 0.28, 0.48);
    cx += fwd[0] * (clamped - along);
    cz += fwd[2] * (clamped - along);
    s.center[0] = cx;
    s.center[1] = height;
    s.center[2] = cz;
    s.source = source;
    s.width = width;
    s.depth = depth;
    s.ready = true;
    this.searching = false;
    void this.saveAnchor();
    for (const fn of this.listeners) fn();
  }

  private applyPose(m: Float32Array): void {
    this.player.updateWorldMatrix(true, false);
    const pm = this.player.matrixWorld.elements;
    const x = m[12];
    const y = m[13];
    const z = m[14];
    const s = state.station;
    s.center[0] = pm[0] * x + pm[4] * y + pm[8] * z + pm[12];
    s.center[1] = pm[1] * x + pm[5] * y + pm[9] * z + pm[13];
    s.center[2] = pm[2] * x + pm[6] * y + pm[10] * z + pm[14];
    s.height = s.center[1];
    // anchor -Z is the station forward
    const fx = -(pm[0] * m[8] + pm[4] * m[9] + pm[8] * m[10]);
    const fz = -(pm[2] * m[8] + pm[6] * m[9] + pm[10] * m[10]);
    const fl = Math.hypot(fx, fz) || 1;
    s.forward[0] = fx / fl;
    s.forward[2] = fz / fl;
    s.right[0] = -s.forward[2];
    s.right[2] = s.forward[0];
  }

  private async saveAnchor(): Promise<void> {
    const frame = this.world.renderer.xr.getFrame() as (XRFrame & { createAnchor?: XRFrame['createAnchor'] }) | null;
    const ref = this.world.renderer.xr.getReferenceSpace();
    if (!frame?.createAnchor || !ref || this.anchorRequested) return;
    this.anchorRequested = true;
    try {
      this.player.updateWorldMatrix(true, false);
      const inv = this.player.matrixWorld.clone().invert().elements;
      const c = state.station.center;
      const f = state.station.forward;
      const lx = inv[0] * c[0] + inv[4] * c[1] + inv[8] * c[2] + inv[12];
      const ly = inv[1] * c[0] + inv[5] * c[1] + inv[9] * c[2] + inv[13];
      const lz = inv[2] * c[0] + inv[6] * c[1] + inv[10] * c[2] + inv[14];
      const yaw = Math.atan2(-f[0], -f[2]);
      const pose = new XRRigidTransform({ x: lx, y: ly, z: lz }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      const anchor = await frame.createAnchor(pose, ref);
      if (!anchor) return;
      this.anchor = anchor;
      state.station.anchored = true;
      const persistent = anchor as XRAnchor & { requestPersistentHandle?: () => Promise<string> };
      if (persistent.requestPersistentHandle) {
        // the browser keeps few persistent anchors per site: free yesterday's first
        const session = frame.session as XRSession & { deletePersistentAnchor?: (h: string) => Promise<void> };
        let old: string | null = null;
        try {
          old = localStorage.getItem(ANCHOR_KEY);
        } catch {
          old = null;
        }
        if (old) await session.deletePersistentAnchor?.(old).catch(() => undefined);
        const handle = await persistent.requestPersistentHandle();
        try {
          localStorage.setItem(ANCHOR_KEY, handle);
        } catch {
          /* storage unavailable: the station is re-found next time */
        }
      }
    } catch {
      state.station.anchored = false;
    }
  }

  private acceptRestored(m: Float32Array): boolean {
    this.player.updateWorldMatrix(true, false);
    const pm = this.player.matrixWorld.elements;
    const x = pm[0] * m[12] + pm[4] * m[13] + pm[8] * m[14] + pm[12];
    const y = pm[1] * m[12] + pm[5] * m[13] + pm[9] * m[14] + pm[13];
    const z = pm[2] * m[12] + pm[6] * m[13] + pm[10] * m[14] + pm[14];
    const head = state.head;
    if (y < 0.3 || y > head[1] - 0.15) return false;
    return Math.hypot(x - head[0], z - head[2]) < 0.9;
  }

  private discardRestored(): void {
    this.restoreWait = -1;
    this.anchor?.delete?.();
    this.anchor = null;
    this.anchorRequested = false;
    state.station.anchored = false;
  }

  private async restoreAnchor(frame: XRFrame): Promise<void> {
    let handle: string | null = null;
    try {
      handle = localStorage.getItem(ANCHOR_KEY);
    } catch {
      handle = null;
    }
    const session = frame.session as XRSession & { restorePersistentAnchor?: (h: string) => Promise<XRAnchor> };
    if (!handle || !session.restorePersistentAnchor) return;
    try {
      const anchor = await session.restorePersistentAnchor(handle);
      if (!this.searching || this.anchor) {
        // the table was found while the anchor was loading
        anchor.delete?.();
        return;
      }
      // checked against the head in update() before the station moves there
      this.anchor = anchor;
      this.anchorRequested = true;
      this.restoreWait = 0;
    } catch {
      try {
        localStorage.removeItem(ANCHOR_KEY);
      } catch {
        /* ignore */
      }
    }
  }
}

export { v3 as _v3 };
