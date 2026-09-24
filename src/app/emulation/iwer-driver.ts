/**
 * Feeds synthetic hands into the IWER emulator.
 *
 * IWER renders hands from pose configurations: one offset matrix per joint,
 * relative to the hand's target-ray space. This driver registers a live pose
 * on each emulated hand, parks the hand's ray space at the reference-space
 * origin, and rewrites the joint matrices every frame. The app then reads the
 * hands back through the ordinary WebXR `fillPoses` path, and IWSDK's poke
 * pointer sees the same fingertips, so emulation exercises the production
 * input code end to end.
 *
 * IWER authors hand poses as left hands and mirrors them for the right hand
 * (x negated, rotation conjugated by the same reflection). The right-hand
 * matrices are pre-mirrored here so that IWER's mirror restores them.
 */
import { Handedness, JOINT_COUNT, JOINT_NAMES, Pose } from '../../core/joints.js';

interface IwerHand {
  poseId: string;
  position: { set(x: number, y: number, z: number): unknown };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
  connected: boolean;
  updatePinchValue?(v: number): void;
}

interface IwerDevice {
  hands: Record<Handedness, IwerHand>;
  primaryInputMode: 'controller' | 'hand';
  /** 'manual' lets the dev UI drive poses each frame; 'programmatic' leaves them to code. */
  controlMode?: 'manual' | 'programmatic';
  position: { set(x: number, y: number, z: number): unknown; x: number; y: number; z: number };
  quaternion: { set(x: number, y: number, z: number, w: number): unknown };
}

type LivePose = { jointTransforms: Record<string, { offsetMatrix: Float32Array; radius: number }> };

// IWER shares one pose dictionary between both hands, so each hand gets its own id
const POSE_ID: Record<Handedness, string> = { left: 'understudy-live-left', right: 'understudy-live-right' };
const MIRROR = [1, -1, -1, 0, -1, 1, 1, 0, -1, 1, 1, 0, -1, 1, 1, 1];
const RADII: Record<string, number> = { wrist: 0.02, tip: 0.008, default: 0.01 };

export function findIwerDevice(): IwerDevice | null {
  const xr = (navigator as unknown as { xr?: object }).xr;
  if (!xr) return null;
  for (const sym of Object.getOwnPropertySymbols(xr)) {
    const v = (xr as Record<symbol, { device?: IwerDevice }>)[sym];
    if (v && typeof v === 'object' && v.device && v.device.hands) return v.device;
  }
  return null;
}

function poseStore(hand: object): Record<string, LivePose> | null {
  for (const sym of Object.getOwnPropertySymbols(hand)) {
    const v = (hand as Record<symbol, { poses?: Record<string, LivePose> }>)[sym];
    if (v && typeof v === 'object' && v.poses && 'default' in v.poses) return v.poses;
  }
  return null;
}

export class IwerHandDriver {
  readonly device: IwerDevice;
  private readonly live: Record<Handedness, LivePose> = { left: makePose(), right: makePose() };
  private installed = false;

  constructor(device: IwerDevice) {
    this.device = device;
  }

  static tryCreate(): IwerHandDriver | null {
    const d = findIwerDevice();
    return d ? new IwerHandDriver(d) : null;
  }

  install(): boolean {
    if (this.installed) return true;
    this.claim();
    this.device.primaryInputMode = 'hand';
    for (const h of ['left', 'right'] as Handedness[]) {
      const hand = this.device.hands[h];
      const store = poseStore(hand);
      if (!store) return false;
      store[POSE_ID[h]] = this.live[h];
      hand.poseId = POSE_ID[h];
      hand.position.set(0, 0, 0);
      hand.quaternion.set(0, 0, 0, 1);
      hand.connected = true;
      hand.updatePinchValue?.(0);
    }
    this.installed = true;
    return true;
  }

  /**
   * Takes pose control from the emulator's dev UI, which otherwise rewrites
   * the headset and hand transforms every frame. Called every frame because
   * a finished remote-control command hands control back to the dev UI.
   */
  claim(): void {
    if (this.device.controlMode !== undefined && this.device.controlMode !== 'programmatic') {
      this.device.controlMode = 'programmatic';
    }
    for (const h of ['left', 'right'] as Handedness[]) {
      const hand = this.device.hands[h];
      hand.position.set(0, 0, 0);
      hand.quaternion.set(0, 0, 0, 1);
    }
  }

  /**
   * Writes a hand's joints. `refFromWorld` converts world space to the XR
   * reference space (the inverse of the player transform).
   */
  setHand(h: Handedness, worldPose: Pose, refFromWorld: ArrayLike<number>): void {
    const jt = this.live[h].jointTransforms;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const m = jt[JOINT_NAMES[j]].offsetMatrix;
      mul(m, refFromWorld, worldPose, j * 16);
      if (h === 'right') for (let i = 0; i < 16; i++) m[i] *= MIRROR[i];
    }
  }

  setConnected(h: Handedness, connected: boolean): void {
    this.device.hands[h].connected = connected;
  }

  setHead(x: number, y: number, z: number, q: ArrayLike<number>): void {
    this.device.position.set(x, y, z);
    this.device.quaternion.set(q[0], q[1], q[2], q[3]);
  }
}

function makePose(): LivePose {
  const jointTransforms: LivePose['jointTransforms'] = {};
  for (const name of JOINT_NAMES) {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    jointTransforms[name] = {
      offsetMatrix: m,
      radius: name === 'wrist' ? RADII.wrist : name.endsWith('tip') ? RADII.tip : RADII.default,
    };
  }
  return { jointTransforms };
}

function mul(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>, ob: number): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[ob + c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
}
