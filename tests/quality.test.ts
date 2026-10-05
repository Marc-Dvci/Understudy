import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@iwsdk/core', () => ({ createSystem: () => class {} }));
vi.mock('../src/app/flow/engine.js', () => ({ flow: { paused: false } }));
import { QualitySystem } from '../src/app/quality.js';
import { state } from '../src/app/state.js';

beforeEach(() => { state.immersive = true; });

function setup() {
  const session = { supportedFrameRates: new Float32Array([60, 72, 90]), frameRate: 90,
    updateTargetFrameRate: vi.fn().mockResolvedValue(undefined) };
  const setFoveation = vi.fn();
  const world = { session, renderer: { xr: { setFoveation } } };
  const quality = new QualitySystem();
  Object.defineProperty(quality, 'world', { value: world });
  return { quality, world, session, setFoveation };
}

it('reduces refresh rate on sustained slow frames without increasing foveation', () => {
  const { quality, session, setFoveation } = setup();
  for (let i = 0; i < 1000; i++) quality.update(1 / 55);
  expect(session.updateTargetFrameRate.mock.calls.map(call => call[0])).toEqual([90, 72, 60]);
  expect(setFoveation.mock.calls).toEqual([[.5]]);
  expect(quality.targetHz).toBe(60);
  expect(quality.step).toBe(2);
});

it('resets the governor and frame samples when a new XR session starts', () => {
  const { quality, world, session } = setup();
  for (let i = 0; i < 1000; i++) quality.update(1 / 55);
  world.session = { ...session, supportedFrameRates: new Float32Array([72, 90]) };
  quality.update(1 / 90);
  expect(quality.step).toBe(0);
  expect(quality.targetHz).toBe(90);
  // summary() uses the runtime browser's user agent.
  vi.stubGlobal('navigator', { userAgent: 'Quest 3' });
  expect(quality.summary().p95).toBe(11.1);
  vi.unstubAllGlobals();
});
