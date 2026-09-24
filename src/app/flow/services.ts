/**
 * Handles to the systems a flow script drives, set once at start-up.
 */
import type { MirrorSystem } from '../mirror-system.js';
import type { StationSystem } from '../station.js';

export const services: {
  station: StationSystem | null;
  mirror: MirrorSystem | null;
  base: string;
} = {
  station: null,
  mirror: null,
  base: './',
};
