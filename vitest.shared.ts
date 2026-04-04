import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import dotenv from 'dotenv';

/**
 * Shared vitest test configuration.
 * Import and spread into each component's vitest.config.ts.
 *
 * Usage:
 *   import { sharedTestConfig } from '../vitest.shared.js';
 *   export default defineConfig({ test: { ...sharedTestConfig, ...overrides } });
 */
export const sharedTestConfig = {
  globals: true,
  environment: 'node' as const,
};

/**
 * Load the project root .env file by walking up from the given directory.
 *
 * Usage:
 *   import { loadEnv } from '../vitest.shared.js';
 *   loadEnv(__dirname);
 */
export function loadEnv(dir: string): void {
  let current = dir;
  while (true) {
    const envPath = resolve(current, '.env');
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
      return;
    }
    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding .env
      break;
    }
    current = parent;
  }
}
