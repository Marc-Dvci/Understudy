/**
 * Tests for the visit-mode wire codec and the room-code helper.
 *
 * Test transforms are built from axis-angle here, independently of the codec,
 * so the round-trip checks do not share the codec's quaternion maths.
 */
import { describe, expect, it } from 'vitest';
import { POSE_FLOATS } from '../src/core/joints.js';
import { gauss, rng } from '../src/core/math.js';
import {
  CODEC_VERSION,
  decodePose,
  encodePose,
  packMessage,
  unpackMessage,
  type VisitMessage,
} from '../src/core/pose-codec.js';
import { randomCode } from '../src/app/visit-link.js';

const JOINTS = 25;
const POS_TOL_M = 0.0002; // 0.2 mm
const ROT_TOL_RAD = (0.2 * Math.PI) / 180; // 0.2 degrees

/** Column-major rigid matrix (rotation about an axis, then a translation). */
function rigid(axis: number[], angle: number, pos: number[]): Float32Array {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const x = axis[0] / len;
  const y = axis[1] / len;
  const z = axis[2] / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const m = new Float32Array(16);
  m[0] = c + t * x * x;
  m[1] = s * z + t * x * y;
  m[2] = -s * y + t * x * z;
  m[4] = -s * z + t * x * y;
  m[5] = c + t * y * y;
  m[6] = s * x + t * y * z;
  m[8] = s * y + t * x * z;
  m[9] = -s * x + t * y * z;
  m[10] = c + t * z * z;
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
  m[15] = 1;
  return m;
}

function randomRigid(r: () => number): Float32Array {
  return rigid(
    [gauss(r), gauss(r), gauss(r)],
    r() * 2 * Math.PI,
    [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1],
  );
}

function randomPose(r: () => number): Float32Array {
  const pose = new Float32Array(POSE_FLOATS);
  for (let j = 0; j < JOINTS; j++) pose.set(randomRigid(r), j * 16);
  return pose;
}

/** Position error (metres) and rotation error (radians) of joint `j`. */
function jointError(a: Float32Array, b: Float32Array, j: number): { pos: number; rot: number } {
  const o = j * 16;
  const pos = Math.hypot(a[o + 12] - b[o + 12], a[o + 13] - b[o + 13], a[o + 14] - b[o + 14]);
  // trace(Ra^T Rb) is the Frobenius inner product of the two rotation blocks.
  let trace = 0;
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < 3; row++) trace += a[o + col * 4 + row] * b[o + col * 4 + row];
  }
  const rot = Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
  return { pos, rot };
}

describe('encodePose / decodePose', () => {
  it('round-trips random rigid poses within 0.2 mm and 0.2 degrees', () => {
    const r = rng(42);
    let worstPos = 0;
    let worstRot = 0;
    for (let trial = 0; trial < 100; trial++) {
      const pose = randomPose(r);
      const back = decodePose(encodePose(pose));
      for (let j = 0; j < JOINTS; j++) {
        const e = jointError(pose, back, j);
        worstPos = Math.max(worstPos, e.pos);
        worstRot = Math.max(worstRot, e.rot);
      }
    }
    expect(worstPos).toBeLessThan(POS_TOL_M);
    expect(worstRot).toBeLessThan(ROT_TOL_RAD);
  });

  it('decodes to rigid matrices with a 0 0 0 1 last row', () => {
    const back = decodePose(encodePose(randomPose(rng(3))));
    expect(back.length).toBe(POSE_FLOATS);
    for (let j = 0; j < JOINTS; j++) {
      const o = j * 16;
      expect([back[o + 3], back[o + 7], back[o + 11], back[o + 15]]).toEqual([0, 0, 0, 1]);
      const c0 = [back[o], back[o + 1], back[o + 2]];
      const c1 = [back[o + 4], back[o + 5], back[o + 6]];
      const c2 = [back[o + 8], back[o + 9], back[o + 10]];
      const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(c0, c0)).toBeCloseTo(1, 4);
      expect(dot(c1, c1)).toBeCloseTo(1, 4);
      expect(dot(c2, c2)).toBeCloseTo(1, 4);
      expect(dot(c0, c1)).toBeCloseTo(0, 4);
      expect(dot(c0, c2)).toBeCloseTo(0, 4);
      expect(dot(c1, c2)).toBeCloseTo(0, 4);
    }
  });

  it('stores w >= 0 for every joint, including turns past 180 degrees', () => {
    const r = rng(9);
    const negative: number[] = [];
    for (let trial = 0; trial < 50; trial++) {
      const packed = encodePose(randomPose(r));
      for (let j = 0; j < JOINTS; j++) {
        if (packed[j * 7 + 6] < 0) negative.push(j);
      }
    }
    expect(negative).toEqual([]);
  });

  it('flips the quaternion when Shepperd gives w < 0 (240 degree turn about x)', () => {
    const pose = new Float32Array(POSE_FLOATS);
    pose.set(rigid([1, 0, 0], (4 * Math.PI) / 3, [0.1, -0.2, 0.3]), 0);
    const packed = encodePose(pose);
    // The unit quaternion (0.866, 0, 0, -0.5) is stored as (-0.866, 0, 0, 0.5).
    expect(Math.abs(packed[3] - -0.8660254 * 32767)).toBeLessThanOrEqual(1);
    expect(packed[4]).toBe(0);
    expect(packed[5]).toBe(0);
    expect(Math.abs(packed[6] - 0.5 * 32767)).toBeLessThanOrEqual(1);
    const back = decodePose(packed);
    expect(jointError(pose, back, 0).rot).toBeLessThan(ROT_TOL_RAD);
  });

  it('clamps positions beyond the int16 range', () => {
    const pose = new Float32Array(POSE_FLOATS);
    pose.set(rigid([0, 0, 1], 0, [5, -5, 0.5]), 0);
    const packed = encodePose(pose);
    expect([packed[0], packed[1], packed[2]]).toEqual([32767, -32768, 5000]);
    const back = decodePose(packed);
    expect(back[12]).toBeCloseTo(3.2767, 4);
    expect(back[13]).toBeCloseTo(-3.2768, 4);
  });

  it('rejects arrays of the wrong length', () => {
    expect(() => encodePose(new Float32Array(10))).toThrow(RangeError);
    expect(() => decodePose(new Int16Array(10))).toThrow(RangeError);
  });
});

describe('visit messages', () => {
  const r = rng(11);
  const left = encodePose(randomPose(r));
  const right = encodePose(randomPose(r));

  it('round-trips hello, hands and event messages', () => {
    const cases: VisitMessage[] = [
      { t: 'hello', v: CODEC_VERSION, name: 'Marc' },
      { t: 'hands', seq: 0, left, right },
      { t: 'hands', seq: 4294967295, left, right: null },
      { t: 'hands', seq: 7, left: null, right },
      { t: 'hands', seq: 8, left: null, right: null },
      { t: 'event', name: 'cheer' },
      { t: 'event', name: 'flower-rep' },
      { t: 'event', name: 'bye' },
    ];
    for (const m of cases) expect(unpackMessage(packMessage(m))).toEqual(m);
  });

  it('uses the documented sizes and little-endian layout', () => {
    const both = packMessage({ t: 'hands', seq: 0x01020304, left, right });
    expect(both.byteLength).toBe(6 + 2 * 350);
    const view = new DataView(both);
    expect(view.getUint8(0)).toBe(2);
    expect(view.getUint32(1, true)).toBe(0x01020304);
    expect(view.getUint8(5)).toBe(3);
    expect(view.getInt16(6, true)).toBe(left[0]);
    expect(view.getInt16(6 + 350, true)).toBe(right[0]);
    expect(packMessage({ t: 'hands', seq: 1, left, right: null }).byteLength).toBe(356);
    expect(packMessage({ t: 'event', name: 'bye' }).byteLength).toBe(2);
    const hello = packMessage({ t: 'hello', v: CODEC_VERSION, name: 'Marc' });
    expect(new Uint8Array(hello)).toEqual(new Uint8Array([1, 1, 77, 97, 114, 99]));
  });

  it('returns null for truncated buffers', () => {
    const hands = packMessage({ t: 'hands', seq: 5, left, right });
    expect(unpackMessage(hands.slice(0, hands.byteLength - 1))).toBeNull();
    expect(unpackMessage(hands.slice(0, 6 + 350))).toBeNull();
    expect(unpackMessage(hands.slice(0, 5))).toBeNull();
    expect(unpackMessage(new ArrayBuffer(0))).toBeNull();
    expect(unpackMessage(packMessage({ t: 'event', name: 'bye' }).slice(0, 1))).toBeNull();
    expect(
      unpackMessage(packMessage({ t: 'hello', v: CODEC_VERSION, name: 'Marc' }).slice(0, 1)),
    ).toBeNull();
  });

  it('returns null for an unknown message type', () => {
    const hands = packMessage({ t: 'hands', seq: 1, left, right: null });
    for (const type of [0, 4, 9, 255]) {
      const copy = hands.slice(0);
      new Uint8Array(copy)[0] = type;
      expect(unpackMessage(copy)).toBeNull();
    }
  });

  it('returns null for malformed fields and trailing bytes', () => {
    const hands = packMessage({ t: 'hands', seq: 1, left, right: null });

    const reserved = hands.slice(0);
    new DataView(reserved).setUint8(5, 1 | 4); // bit 2 is not defined
    expect(unpackMessage(reserved)).toBeNull();

    const extra = new Uint8Array(hands.byteLength + 1);
    extra.set(new Uint8Array(hands));
    expect(unpackMessage(extra.buffer)).toBeNull();

    const event = (code: number): ArrayBuffer => {
      const view = new DataView(new ArrayBuffer(2));
      view.setUint8(0, 3);
      view.setUint8(1, code);
      return view.buffer as ArrayBuffer;
    };
    expect(unpackMessage(event(0))).toBeNull();
    expect(unpackMessage(event(4))).toBeNull();
    expect(unpackMessage(event(2))).toEqual({ t: 'event', name: 'flower-rep' });

    expect(unpackMessage(42 as unknown as ArrayBuffer)).toBeNull();
    expect(unpackMessage(null as unknown as ArrayBuffer)).toBeNull();
  });

  it('returns null for a wrong codec version', () => {
    expect(unpackMessage(packMessage({ t: 'hello', v: CODEC_VERSION + 1, name: 'Marc' }))).toBeNull();
    expect(unpackMessage(packMessage({ t: 'hello', v: 0, name: 'Marc' }))).toBeNull();
    expect(unpackMessage(packMessage({ t: 'hello', v: CODEC_VERSION, name: 'Marc' }))).toEqual({
      t: 'hello',
      v: CODEC_VERSION,
      name: 'Marc',
    });
  });

  it('truncates long names at a UTF-8 code-point boundary', () => {
    const cases: [string, string][] = [
      ['a'.repeat(31) + 'é', 'a'.repeat(31)], // e-acute is two bytes; the split one is dropped
      ['a'.repeat(30) + '€', 'a'.repeat(30)], // euro sign is three bytes
      ['x'.repeat(29) + '\u{1F600}', 'x'.repeat(29)], // emoji is four bytes
      ['é'.repeat(16), 'é'.repeat(16)], // exactly 32 bytes is kept whole
      ['é'.repeat(40), 'é'.repeat(16)],
    ];
    for (const [input, want] of cases) {
      const buf = packMessage({ t: 'hello', v: CODEC_VERSION, name: input });
      expect(buf.byteLength).toBeLessThanOrEqual(2 + 32);
      expect(unpackMessage(buf)).toEqual({ t: 'hello', v: CODEC_VERSION, name: want });
    }
  });

  it('rejects a hand that is not 175 values when packing', () => {
    expect(() =>
      packMessage({ t: 'hands', seq: 1, left: new Int16Array(10), right: null }),
    ).toThrow(RangeError);
  });
});

describe('randomCode', () => {
  it('returns a zero-padded four-digit code', () => {
    expect(randomCode(rng(7))).toMatch(/^\d{4}$/);
    expect(randomCode(() => 0)).toBe('0000');
    expect(randomCode(() => 0.00015)).toBe('0001');
    expect(randomCode(() => 0.99999)).toBe('9999');
    expect(randomCode(() => 1)).toBe('9999');
    const r = rng(7);
    for (let i = 0; i < 200; i++) expect(randomCode(r)).toMatch(/^\d{4}$/);
  });
});
