import { describe, expect, it } from 'vitest';
import { angleDelta, forearmRoll, pinchDistance, RepCounter, wristPitch } from '../src/core/movement.js';
import { q4, quatAxisAngle, quatMul, RAD, v3 } from '../src/core/math.js';
import { palmDownOrientation, thumbToFinger } from '../src/sim/actor.js';
import { buildPose, openAngles, restAngles } from '../src/sim/handmodel.js';

const UP = v3(0, 1, 0);
const FORWARD = v3(0, 0, -1);

/** A right hand resting on a table, palm down, fingers toward -Z, with the given orientation. */
function handWith(orientation: Float64Array | number[]) {
  return buildPose(restAngles(), 'right', { length: 0.19 }, { position: v3(0, 1, 0), orientation });
}

function palmDownHand() {
  return handWith(palmDownOrientation(FORWARD));
}

/** The palm-down orientation with an extra rotation applied on the hand's own axes. */
function rotated(axis: Float64Array, degrees: number) {
  return quatMul(q4(), palmDownOrientation(FORWARD), quatAxisAngle(q4(), axis, degrees * RAD));
}

describe('forearmRoll', () => {
  it('is about 0 for a palm-down hand with the back of the hand up', () => {
    expect(Math.abs(forearmRoll(palmDownHand(), UP))).toBeLessThan(5);
  });

  it('is about 90 degrees when the hand is rolled 90 degrees about the forward axis', () => {
    const roll = forearmRoll(handWith(rotated(FORWARD, 90)), UP);
    expect(Math.abs(Math.abs(roll) - 90)).toBeLessThan(5);
  });

  it('is about 180 degrees when the hand is rolled 180 degrees, palm up', () => {
    const roll = forearmRoll(handWith(rotated(FORWARD, 180)), UP);
    expect(Math.abs(Math.abs(roll) - 180)).toBeLessThan(5);
  });

  it('changes sign with the direction of the roll', () => {
    const plus = forearmRoll(handWith(rotated(FORWARD, 60)), UP);
    const minus = forearmRoll(handWith(rotated(FORWARD, -60)), UP);
    expect(Math.sign(plus)).toBe(-Math.sign(minus));
    expect(Math.abs(Math.abs(plus) - 60)).toBeLessThan(5);
  });
});

describe('wristPitch', () => {
  it('is about 0 for a hand resting palm down (within 10 degrees)', () => {
    expect(Math.abs(wristPitch(palmDownHand(), UP))).toBeLessThan(10);
  });

  it('rises by about 40 degrees when the hand is pitched up 40 degrees about its own x axis', () => {
    const base = wristPitch(palmDownHand(), UP);
    const up = wristPitch(handWith(rotated(v3(1, 0, 0), 40)), UP);
    expect(Math.abs(up - base - 40)).toBeLessThan(6);
    expect(up).toBeGreaterThan(base);
  });
});

describe('pinchDistance', () => {
  it('is small when the thumb touches the index fingertip', () => {
    const pose = buildPose(thumbToFinger('right', 0), 'right', { length: 0.19 }, { position: v3(), orientation: q4() });
    expect(pinchDistance(pose)).toBeLessThan(0.02);
  });

  it('is large with the fingers open', () => {
    const pose = buildPose(openAngles(), 'right', { length: 0.19 }, { position: v3(), orientation: q4() });
    expect(pinchDistance(pose)).toBeGreaterThan(0.05);
  });
});

describe('angleDelta', () => {
  it('takes the short way round the wrap at 180', () => {
    expect(angleDelta(170, -170)).toBeCloseTo(-20, 10);
    expect(angleDelta(-170, 170)).toBeCloseTo(20, 10);
  });

  it('gives the plain difference when no wrap is needed, and 0 for equal angles', () => {
    expect(angleDelta(30, 10)).toBeCloseTo(20, 10);
    expect(angleDelta(10, 30)).toBeCloseTo(-20, 10);
    expect(angleDelta(45, 45)).toBe(0);
    expect(angleDelta(10, 350)).toBeCloseTo(20, 10);
  });
});

describe('RepCounter', () => {
  it('completes one repetition on the way back, with the peak excursion', () => {
    const c = new RepCounter(20, 5);
    const done = [0, 10, 25, 10, 3].map((v) => c.update(v));
    expect(done).toEqual([false, false, false, false, true]);
    expect(c.reps).toBe(1);
    expect(c.peak).toBe(25);
  });

  it('does not count a return that is not yet within the back margin', () => {
    const c = new RepCounter(20, 5);
    for (const v of [0, 25, 10, 6]) c.update(v);
    expect(c.reps).toBe(0);
    c.update(4);
    expect(c.reps).toBe(1);
  });

  it('counts two repetitions in a row', () => {
    const c = new RepCounter(20, 5);
    for (const v of [0, 25, 3, 25, 3]) c.update(v);
    expect(c.reps).toBe(2);
  });

  it('ignores NaN, including a NaN before the first value', () => {
    const c = new RepCounter(20, 5);
    expect(c.update(NaN)).toBe(false);
    for (const v of [0, NaN, 25, NaN, 3]) c.update(v);
    expect(c.reps).toBe(1);
    expect(c.peak).toBe(25);
    expect(c.level(NaN)).toBe(0);
  });

  it('handles the wrap at 180 degrees in circular mode', () => {
    const c = new RepCounter(20, 5, true);
    for (const v of [170, -170, -178, 175]) c.update(v);
    expect(c.reps).toBe(1);
    // the wrapped excursion is 20 degrees, not 340
    expect(c.peak).toBeCloseTo(20, 10);
  });

  it('measures the same wrap as a 340 degree excursion when not circular', () => {
    const c = new RepCounter(20, 5);
    for (const v of [170, -170]) c.update(v);
    expect(c.peak).toBeCloseTo(340, 10);
  });

  it('reports progress toward the next out-stroke, capped at 1', () => {
    const c = new RepCounter(20, 5);
    c.update(0);
    expect(c.level(10)).toBeCloseTo(0.5, 10);
    expect(c.level(50)).toBe(1);
  });
});
