/**
 * Handles to the systems a flow script drives, set once at start-up.
 */
import type { MirrorSystem } from '../mirror-system.js';
import type { StationSystem } from '../station.js';
import type { QualitySystem } from '../quality.js';

export const services: {
  station: StationSystem | null;
  mirror: MirrorSystem | null;
  quality: QualitySystem | null;
  base: string;
} = {
  station: null,
  mirror: null,
  quality: null,
  base: './',
};
