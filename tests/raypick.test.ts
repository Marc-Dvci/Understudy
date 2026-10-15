import { describe, expect, it } from 'vitest';
import { rayPick } from '../src/app/ui/press.js';

const stone = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

describe('rayPick', () => {
  it('picks the stone straight ahead of the ray', () => {
    const stones = [stone('ahead', 0, 0, -0.5), stone('right', 0.5, 0, 0)];
    expect(rayPick(stones, [0, 0, 0], [0, 0, -1])).toBe('ahead');
  });

  it('returns null when the nearest direction is outside maxAngle', () => {
    // 45 degrees off the ray, beyond the 0.12 rad default
    const stones = [stone('off', 1, 0, -1)];
    expect(rayPick(stones, [0, 0, 0], [0, 0, -1])).toBeNull();
    expect(rayPick(stones, [0, 0, 0], [0, 0, -1], 1)).toBe('off');
  });

  it('picks the stone with the smallest angle when two are inside maxAngle', () => {
    // a is about 5.7 degrees off, b about 2.9 degrees off; a is listed first
    const stones = [stone('a', 0.1, 0, -1), stone('b', 0, 0.05, -1)];
    expect(rayPick(stones, [0, 0, 0], [0, 0, -1])).toBe('b');
  });

  it('returns null for a zero direction', () => {
    expect(rayPick([stone('ahead', 0, 0, -1)], [0, 0, 0], [0, 0, 0])).toBeNull();
  });

  it('does not need a normalised direction', () => {
    expect(rayPick([stone('ahead', 0, 0, -1)], [0, 0, 0], [0, 0, -7])).toBe('ahead');
  });

  it('returns null for a stone behind the ray origin', () => {
    expect(rayPick([stone('behind', 0, 0, 1)], [0, 0, 0], [0, 0, -1])).toBeNull();
  });
});
