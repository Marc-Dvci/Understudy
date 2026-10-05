import { beforeEach, describe, expect, it, vi } from 'vitest';
// Exercise joint-based input independently from the browser renderer.
vi.mock('@iwsdk/core', () => ({ Vector3: class {
  x = 0; y = 0; z = 0;
  set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
} }));
import { PressInput } from '../src/app/ui/press.js';
import type { Stone } from '../src/app/ui/stone.js';
import { state } from '../src/app/state.js';

function stone(): Stone {
  return { id: 'target', shown: true, enabled: true, radius: 0.05, topHeight: 0.016,
    group: { scale: { y: 1 }, getWorldPosition: (v: { set(x: number, y: number, z: number): unknown }) => v.set(0, 0, 0) },
    hover: 0, dwell: 0, pressed: 0, update: () => {}, hide() { (this as unknown as { shown: boolean }).shown = false; },
  } as unknown as Stone;
}
function hand(side: 'left' | 'right', valid = true, x = 0): void {
  const h = state.hands[side];
  h.valid = valid;
  h.lostFor = valid ? 0 : 1;
  h.indexTip.set([x, 0.045, 0]);
  h.thumbTip.set([1, 1, 1]);
  h.indexTipSpeed = 0;
}

beforeEach(() => { hand('left'); hand('right', false); state.profile.dwellSeconds = 1; });

describe('accessible presses', () => {
  it('requires a continuous dwell after leaving and re-entering a target', () => {
    const input = new PressInput(); input.add(stone());
    const press = vi.fn(); input.onPress(press);
    for (let i = 0; i < 7; i++) input.update(0.1);
    hand('left', true, 1); input.update(0.1);
    hand('left');
    for (let i = 0; i < 7; i++) input.update(0.1);
    expect(press).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) input.update(0.1);
    expect(press).toHaveBeenCalledWith('target', 'dwell');
  });
  it('resets dwell when tracking is lost', () => {
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    for (let i = 0; i < 7; i++) input.update(0.1);
    hand('left', false); input.update(0.1); hand('left');
    for (let i = 0; i < 7; i++) input.update(0.1);
    expect(press).not.toHaveBeenCalled();
  });
  it('keeps two hands from adding their partial dwells together', () => {
    hand('right');
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    for (let i = 0; i < 6; i++) input.update(0.1);
    expect(press).not.toHaveBeenCalled();
  });
  it('rejects a fingertip far below the physical table', () => {
    state.hands.left.indexTip[1] = -0.2;
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    for (let i = 0; i < 20; i++) input.update(0.1);
    expect(press).not.toHaveBeenCalled();
  });
  it('removes a pending choice on Stop', async () => {
    const input = new PressInput(); input.add(stone());
    const choice = input.wait(['target']);
    const rejected = expect(choice).rejects.toThrow('stop');
    input.cancelPending(new Error('stop')); await rejected;
    input.press('target', 'pointer');
  });
  it('allows only the session controls while paused', () => {
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    input.allowedIds = new Set(['resume']);
    for (let i = 0; i < 20; i++) input.update(0.1);
    input.press('target', 'pointer');
    expect(press).not.toHaveBeenCalled();
  });
  it('confirms a hovered stone by thumb tap without waiting for dwell', () => {
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    state.time = 0;
    input.update(0.02);
    state.hands.left.thumbTip.set([0, 0, 0]);
    input.update(0.02);
    state.time = 0.1;
    state.hands.left.thumbTip.set([1, 1, 1]);
    input.update(0.02);
    expect(press).toHaveBeenCalledWith('target', 'thumb');
  });
  it('does not confirm a stale hovered stone when the thumb tap ends elsewhere', () => {
    const input = new PressInput(); input.add(stone()); const press = vi.fn(); input.onPress(press);
    state.time = 0;
    state.hands.left.thumbTip.set([0, 0, 0]); input.update(0.02);
    hand('left', true, 1); state.time = 0.1; input.update(0.02);
    expect(press).not.toHaveBeenCalled();
  });
});
