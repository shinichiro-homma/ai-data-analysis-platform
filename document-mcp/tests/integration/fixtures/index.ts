import { getDataEnv } from '../helpers/env-helper.js';
import { sampleFixture } from './sample.js';
import { productionFixture } from './production.js';
import type { EnvFixture } from './types.js';

export type { EnvFixture } from './types.js';

export function getFixture(): EnvFixture {
  const env = getDataEnv();
  return env === 'production' ? productionFixture : sampleFixture;
}
