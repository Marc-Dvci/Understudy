import { defineConfig } from 'vitest/config';

// Tests run the framework-free core and simulation code in Node, without the
// IWSDK dev plugin that vite.config.ts installs.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
});
