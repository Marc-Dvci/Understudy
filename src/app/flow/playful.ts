/**
 * The Playful style: a burst of petals when a repetition completes. It
 * celebrates the movement and never counts or scores it.
 */
import type { Vector3 } from '@iwsdk/core';
import { PetalBursts } from '../render/burst.js';
import { stage } from '../stage.js';
import { state } from '../state.js';

/** Bursts petals from a table-local point when the Playful style is on. */
export function celebrate(at: Vector3, count = 9): void {
  if (state.profile.style !== 'playful') return;
  if (!stage.bursts) stage.bursts = new PetalBursts(stage.table);
  stage.bursts.burst(at.x, at.y + 0.01, at.z, count);
}
