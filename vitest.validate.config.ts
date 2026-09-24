import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['validation/**/*.test.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
  },
});
