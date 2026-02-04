import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// テスト実行前に .env を読み込む
config();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30秒
  },
});
