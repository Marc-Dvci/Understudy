import { defineComponents } from '@iwsdk/core';

// Understudy keeps its per-frame state in plain objects (src/app/state.ts):
// joint poses are arrays of 25 matrices, which ECS fields do not model well.
export default defineComponents([]);
