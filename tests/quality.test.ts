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
  // 72 Hz first: the lowest Quest 3 / 3S rate above 60 fps
  expect(session.updateTargetFrameRate.mock.calls.map(call => call[0])).toEqual([72, 60]);
  expect(setFoveation.mock.calls).toEqual([[.5]]);
  expect(quality.targetHz).toBe(60);
  expect(quality.step).toBe(1);
});

it('resets the governor and frame samples when a new XR session starts', () => {
  const { quality, world, session } = setup();
  for (let i = 0; i < 1000; i++) quality.update(1 / 55);
  world.session = { ...session, supportedFrameRates: new Float32Array([72, 90]) };
  quality.update(1 / 90);
  expect(quality.step).toBe(0);
  expect(quality.targetHz).toBe(72);
  // summary() uses the runtime browser's user agent.
  vi.stubGlobal('navigator', { userAgent: 'Quest 3' });
  expect(quality.summary().p95).toBe(11.1);
  vi.unstubAllGlobals();
});

it('reports the whole session in words for the Device check', () => {
  const { quality } = setup();
  for (let i = 0; i < 30000; i++) quality.update(i % 100 === 0 ? 1 / 40 : 1 / 72);
  vi.stubGlobal('navigator', { userAgent: 'Quest 3' });
  const [rate, budget, code] = quality.report();
  vi.unstubAllGlobals();
  expect(rate).toBe('72 fps median at 72 Hz this session.');
  expect(budget).toBe('99% of frames within the 60 fps budget.');
  expect(code.split(' | ')[2]).toBe('72');
});

it('runs the shader warm-up in XR frames and survives one that fails', () => {
  const { quality } = setup();
  let steps = 0;
  quality.requestWarmUp(() => ({ step: () => ++steps === 3, result: { programs: 20, textures: 9, frames: 3, ms: 9 } }) as never);
  for (let i = 0; i < 5; i++) quality.update(1 / 72);
  expect(steps).toBe(3);
  expect(quality.warm?.programs).toBe(20);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  quality.requestWarmUp(() => ({ step: () => { throw new Error('lost context'); }, result: null }) as never);
  expect(() => quality.update(1 / 72)).not.toThrow();
  quality.update(1 / 72);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
