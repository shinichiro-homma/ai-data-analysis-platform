import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000, // 30秒（Jupyter APIへのアクセスを考慮）
    hookTimeout: 10000, // beforeEach/afterEach用
    globals: true,
    environment: 'node',
  },
});
