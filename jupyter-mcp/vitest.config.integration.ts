import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';

// .env ファイルを読み込む
dotenv.config();

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 30000, // 30秒（Jupyter APIへのアクセスを考慮）
    hookTimeout: 10000, // beforeEach/afterEach用
    globals: true,
    environment: 'node',
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true, // 並列実行を無効化（直列実行）
      },
    },
  },
});
