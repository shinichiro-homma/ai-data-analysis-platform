import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from '../vitest.shared.js';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 5000, // 5秒（モック使用のため短め）
    pool: 'forks',
  },
});
