import { defineConfig } from 'vitest/config';
import { sharedTestConfig, loadEnv } from '../../vitest.shared.js';

loadEnv(__dirname);

export default defineConfig({
  test: {
    ...sharedTestConfig,
    testTimeout: 60_000,
    sequence: {
      concurrent: false,
    },
  },
});
