import { defineConfig } from 'vitest/config';
import { sharedTestConfig, loadEnv } from '../vitest.shared.js';

loadEnv(__dirname);

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000, // 30秒（外部API呼び出しを考慮）
    hookTimeout: 10000, // beforeEach/afterEach用
    pool: 'vmThreads',
    sequence: {
      concurrent: false, // テストの直列実行
    },
  },
});
