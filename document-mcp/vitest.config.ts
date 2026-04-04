import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../vitest.shared.js';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    testTimeout: 30000,
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
