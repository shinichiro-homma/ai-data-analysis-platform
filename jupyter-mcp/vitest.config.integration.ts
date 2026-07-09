import { defineConfig } from 'vitest/config';
import { sharedTestConfig, loadEnv } from '../vitest.shared.js';

loadEnv(__dirname);

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 40000, // 40秒（Jupyter APIへのアクセスを考慮）
    hookTimeout: 15000, // beforeEach/afterEach用（リトライ付きクリーンアップを考慮）
    pool: 'forks',
    // vitest 4: poolOptions/singleFork は廃止。maxWorkers:1 + isolate:false が singleFork 相当
    maxWorkers: 1,
    isolate: false,
  },
});
