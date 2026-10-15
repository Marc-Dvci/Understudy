/**
 * Wire codec for visit mode.
 *
 * Hand poses travel in station-local coordinates, so every value is small.
 * Each of the 25 joints becomes seven int16 values: position xyz in metres
 * times 10000 (0.1 mm steps, clamped to about +-3.27 m), then a unit
 * quaternion xyzw times 32767 with w >= 0. One hand is 175 values, 350 bytes.
 *
 * Messages are little-endian binary with a one-byte type:
 *   1 hello  u8 version, then the UTF-8 name (at most 32 bytes, no length prefix)
 *   2 hands  u32 seq, u8 flags (bit 0 left present, bit 1 right present),
 *            then 175 int16 per present hand, left before right
 *   3 event  u8 code (1 cheer, 2 flower-rep, 3 bye)
 *
 * unpackMessage never throws. Anything malformed, unknown or from another
 * codec version comes back as null.
 */
import { JOINT_COUNT, POSE_FLOATS } from './joints.js';
import { clamp, composeMat4, quatFromMat4 } from './math.js';

export const CODEC_VERSION = 1;

/** Seven int16 values per joint: position xyz, quaternion xyzw. */
const VALUES_PER_JOINT = 7;
/** Int16 values in one packed hand. */
export const PACKED_HAND_LENGTH = JOINT_COUNT * VALUES_PER_JOINT;
const PACKED_HAND_BYTES = PACKED_HAND_LENGTH * 2;

const POSITION_SCALE = 10000;
const QUATERNION_SCALE = 32767;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
const NAME_MAX_BYTES = 32;

const TYPE_HELLO = 1;
const TYPE_HANDS = 2;
const TYPE_EVENT = 3;

const HANDS_HEADER_BYTES = 6; // type, u32 seq, u8 flags
const FLAG_LEFT = 1;
const FLAG_RIGHT = 2;
const FLAG_MASK = FLAG_LEFT | FLAG_RIGHT;

/** Event code is the index + 1. */
const EVENT_NAMES: readonly ('cheer' | 'flower-rep' | 'bye')[] = ['cheer', 'flower-rep', 'bye'];

export type VisitMessage =
  | { t: 'hello'; v: number; name: string }
  | { t: 'hands'; seq: number; left: Int16Array | null; right: Int16Array | null }
  | { t: 'event'; name: 'cheer' | 'flower-rep' | 'bye' };

const quatScratch = new Float64Array(4);
const posScratch = new Float64Array(3);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Packs a 25-joint pose (400 floats) into 25 x (position xyz + quaternion xyzw),
 * 175 int16 values. Pass `out` to reuse a buffer.
 */
export function encodePose(
  pose: Float32Array,
  out: Int16Array = new Int16Array(PACKED_HAND_LENGTH),
): Int16Array {
  if (pose.length < POSE_FLOATS || out.length < PACKED_HAND_LENGTH) {
    throw new RangeError('encodePose expects a 400-float pose and a 175-value output');
  }
  const q = quatScratch;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const o = j * 16;
    const k = j * VALUES_PER_JOINT;
    out[k] = quantisePosition(pose[o + 12]);
    out[k + 1] = quantisePosition(pose[o + 13]);
    out[k + 2] = quantisePosition(pose[o + 14]);
    // Shepperd's method; quatFromMat4 returns the quaternion already normalised.
    quatFromMat4(q, pose, o);
    const sign = q[3] < 0 ? -1 : 1;
    for (let c = 0; c < 4; c++) out[k + 3 + c] = quantiseUnit(sign * q[c]);
  }
  return out;
}

/** Rebuilds 25 rigid 4x4 matrices (400 floats) from a packed hand. */
export function decodePose(
  packed: Int16Array,
  out: Float32Array = new Float32Array(POSE_FLOATS),
): Float32Array {
  if (packed.length < PACKED_HAND_LENGTH || out.length < POSE_FLOATS) {
    throw new RangeError('decodePose expects a 175-value input and a 400-float output');
  }
  const p = posScratch;
  const q = quatScratch;
  for (let j = 0; j < JOINT_COUNT; j++) {
    const k = j * VALUES_PER_JOINT;
    p[0] = packed[k] / POSITION_SCALE;
    p[1] = packed[k + 1] / POSITION_SCALE;
    p[2] = packed[k + 2] / POSITION_SCALE;
    let x = packed[k + 3] / QUATERNION_SCALE;
    let y = packed[k + 4] / QUATERNION_SCALE;
    let z = packed[k + 5] / QUATERNION_SCALE;
    let w = packed[k + 6] / QUATERNION_SCALE;
    const len = Math.hypot(x, y, z, w);
    if (len > 0) {
      x /= len;
      y /= len;
      z /= len;
      w /= len;
    } else {
      x = 0;
      y = 0;
      z = 0;
      w = 1;
    }
    q[0] = x;
    q[1] = y;
    q[2] = z;
    q[3] = w;
    // composeMat4 writes the last row as 0 0 0 1.
    composeMat4(out, p, q, j * 16);
  }
  return out;
}

export function packMessage(m: VisitMessage): ArrayBuffer {
  switch (m.t) {
    case 'hello': {
      const name = clampUtf8(encoder.encode(m.name), NAME_MAX_BYTES);
      const bytes = new Uint8Array(2 + name.length);
      bytes[0] = TYPE_HELLO;
      bytes[1] = m.v & 0xff;
      bytes.set(name, 2);
      return bytes.buffer as ArrayBuffer;
    }
    case 'hands': {
      const left = m.left ?? null;
      const right = m.right ?? null;
      const flags = (left ? FLAG_LEFT : 0) | (right ? FLAG_RIGHT : 0);
      const count = (left ? 1 : 0) + (right ? 1 : 0);
      const view = new DataView(new ArrayBuffer(HANDS_HEADER_BYTES + count * PACKED_HAND_BYTES));
      view.setUint8(0, TYPE_HANDS);
      view.setUint32(1, m.seq >>> 0, true);
      view.setUint8(5, flags);
      let offset = HANDS_HEADER_BYTES;
      for (const hand of [left, right]) {
        if (!hand) continue;
        if (hand.length !== PACKED_HAND_LENGTH) {
          throw new RangeError('packMessage expects each hand to hold 175 int16 values');
        }
        for (let i = 0; i < PACKED_HAND_LENGTH; i++) view.setInt16(offset + i * 2, hand[i], true);
        offset += PACKED_HAND_BYTES;
      }
      return view.buffer as ArrayBuffer;
    }
    case 'event': {
      const code = EVENT_NAMES.indexOf(m.name) + 1;
      if (code === 0) throw new RangeError(`packMessage: unknown event ${String(m.name)}`);
      const view = new DataView(new ArrayBuffer(2));
      view.setUint8(0, TYPE_EVENT);
      view.setUint8(1, code);
      return view.buffer as ArrayBuffer;
    }
    default:
      throw new RangeError('packMessage: unknown message type');
  }
}

/** Decodes one frame. Returns null for anything malformed, unknown or a version mismatch. */
export function unpackMessage(buf: ArrayBuffer): VisitMessage | null {
  if (!(buf instanceof ArrayBuffer) || buf.byteLength < 1) return null;
  try {
    const view = new DataView(buf);
    switch (view.getUint8(0)) {
      case TYPE_HELLO:
        return unpackHello(view);
      case TYPE_HANDS:
        return unpackHands(view);
      case TYPE_EVENT:
        return unpackEvent(view);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function quantisePosition(metres: number): number {
  if (!Number.isFinite(metres)) return 0;
  return clamp(Math.round(metres * POSITION_SCALE), INT16_MIN, INT16_MAX);
}

function quantiseUnit(component: number): number {
  return Math.round(clamp(component, -1, 1) * QUATERNION_SCALE);
}

/** Cuts UTF-8 bytes to at most `max`, backing up past any split code point. */
function clampUtf8(bytes: Uint8Array, max: number): Uint8Array {
  if (bytes.length <= max) return bytes;
  let end = max;
  // Continuation bytes are 10xxxxxx; stop on the lead byte of the split character.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end);
}

function unpackHello(view: DataView): VisitMessage | null {
  const length = view.byteLength;
  if (length < 2 || length > 2 + NAME_MAX_BYTES) return null;
  const v = view.getUint8(1);
  if (v !== CODEC_VERSION) return null;
  const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + 2, length - 2));
  return { t: 'hello', v, name };
}

function unpackHands(view: DataView): VisitMessage | null {
  if (view.byteLength < HANDS_HEADER_BYTES) return null;
  const flags = view.getUint8(5);
  if ((flags & ~FLAG_MASK) !== 0) return null;
  const hasLeft = (flags & FLAG_LEFT) !== 0;
  const hasRight = (flags & FLAG_RIGHT) !== 0;
  const count = (hasLeft ? 1 : 0) + (hasRight ? 1 : 0);
  if (view.byteLength !== HANDS_HEADER_BYTES + count * PACKED_HAND_BYTES) return null;
  const seq = view.getUint32(1, true);
  let offset = HANDS_HEADER_BYTES;
  let left: Int16Array | null = null;
  let right: Int16Array | null = null;
  if (hasLeft) {
    left = readHand(view, offset);
    offset += PACKED_HAND_BYTES;
  }
  if (hasRight) right = readHand(view, offset);
  return { t: 'hands', seq, left, right };
}

function unpackEvent(view: DataView): VisitMessage | null {
  if (view.byteLength !== 2) return null;
  const name = EVENT_NAMES[view.getUint8(1) - 1];
  return name === undefined ? null : { t: 'event', name };
}

function readHand(view: DataView, offset: number): Int16Array {
  const hand = new Int16Array(PACKED_HAND_LENGTH);
  for (let i = 0; i < PACKED_HAND_LENGTH; i++) hand[i] = view.getInt16(offset + i * 2, true);
  return hand;
}
