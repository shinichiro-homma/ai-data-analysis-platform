import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    testTimeout: 5000, // 5秒（モック使用のため短め）
    globals: true,
    environment: 'node',
    pool: 'forks',
  },
});
