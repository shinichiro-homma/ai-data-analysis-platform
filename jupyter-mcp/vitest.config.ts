import { defineConfig } from 'vitest/config';
import { sharedTestConfig, loadEnv } from '../vitest.shared.js';

loadEnv(__dirname);

export default defineConfig({
  test: {
    ...sharedTestConfig,
    testTimeout: 30000, // 30秒
  },
});
