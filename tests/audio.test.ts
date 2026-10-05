import { afterEach, expect, it, vi } from 'vitest';
import { Sound } from '../src/app/audio.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps spatial-audio smoothing while scheduling only changed listener targets', () => {
  const names = ['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'];
  const listener = Object.fromEntries(names.map(name => [name, { setTargetAtTime: vi.fn() }]));
  const context = { listener, currentTime: 2, destination: {}, resume: vi.fn().mockResolvedValue(undefined),
    createGain: () => ({ gain: { value: 0 }, connect: vi.fn() }) };
  vi.stubGlobal('window', { AudioContext: class { constructor() { return context; } } });
  const sound = new Sound(); sound.resume();
  for (let i = 0; i < 1000; i++) sound.setListener(0, 1, 0, 0, -.5, -1, 0, 1, 0);
  for (const param of Object.values(listener)) expect(param.setTargetAtTime).toHaveBeenCalledTimes(1);
  context.currentTime = 3;
  sound.setListener(.02, 1, 0, 0, -.5, -1, 0, 1, 0);
  expect(listener.positionX.setTargetAtTime).toHaveBeenLastCalledWith(.02, 3, .02);
  expect(listener.positionX.setTargetAtTime).toHaveBeenCalledTimes(2);
  for (const name of names.slice(1)) expect(listener[name].setTargetAtTime).toHaveBeenCalledTimes(1);
});
