/**
 * document-server パフォーマンステスト
 *
 * 各エンドポイントの応答時間が NF1 要件（200ms 以内）を満たすことを検証する。
 * ウォームアップ 1 回を除外し、以降 4 回の計測で全回 200ms 以内であることを確認する。
 *
 * 前提:
 * - document-server が起動していること（docker-compose up -d）
 *
 * NOTE: document-server 起動時間（NF1: 100テーブル規模で5秒以内）は
 * docker-compose の起動シーケンスに依存するため、ここでは測定しない。
 * docker-compose logs --timestamps で手動確認とする。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  checkServices,
  getTableIndex,
  getTableDetail,
  getTermIndex,
  getTermDetail,
  getLogicIndex,
  getLogicDetail,
  getLogicCode,
} from './helpers/api-client.js';

const THRESHOLD_MS = 200;
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 4;

beforeAll(async () => {
  const status = await checkServices();
  if (!status.document) {
    throw new Error('document-server に接続できません。docker-compose up -d を確認してください。');
  }
});

/**
 * 指定した関数を複数回呼び出し、ウォームアップ後の各回が閾値以内であることを検証する。
 */
async function measureEndpoint(name: string, fn: () => Promise<unknown>, thresholdMs: number): Promise<void> {
  // ウォームアップ
  for (let i = 0; i < WARMUP_RUNS; i++) {
    await fn();
  }

  // 計測
  const times: number[] = [];
  for (let i = 0; i < MEASURE_RUNS; i++) {
    const start = performance.now();
    await fn();
    const elapsed = performance.now() - start;
    times.push(elapsed);
  }

  // 全回が閾値以内であることを検証
  for (let i = 0; i < times.length; i++) {
    expect(times[i], `${name} の ${i + 1} 回目: ${times[i].toFixed(1)}ms (閾値: ${thresholdMs}ms)`).toBeLessThan(
      thresholdMs,
    );
  }
}

describe('document-server API 応答時間テスト (NF1: 200ms以内)', () => {
  it('GET /catalog/index が 200ms 以内で応答する', async () => {
    await measureEndpoint('GET /catalog/index', () => getTableIndex(), THRESHOLD_MS);
  });

  it('POST /catalog/tables が 200ms 以内で応答する', async () => {
    await measureEndpoint('POST /catalog/tables', () => getTableDetail(['id_pos_transactions']), THRESHOLD_MS);
  });

  it('GET /glossary/index が 200ms 以内で応答する', async () => {
    await measureEndpoint('GET /glossary/index', () => getTermIndex(), THRESHOLD_MS);
  });

  it('POST /glossary/terms が 200ms 以内で応答する', async () => {
    await measureEndpoint('POST /glossary/terms', () => getTermDetail(['ロイヤルティランク']), THRESHOLD_MS);
  });

  it('GET /logic/index が 200ms 以内で応答する', async () => {
    await measureEndpoint('GET /logic/index', () => getLogicIndex(), THRESHOLD_MS);
  });

  it('POST /logic/meta が 200ms 以内で応答する', async () => {
    await measureEndpoint('POST /logic/meta', () => getLogicDetail(['sales_basic_aggregation']), THRESHOLD_MS);
  });

  it('GET /logic/code/{name} が 200ms 以内で応答する', async () => {
    await measureEndpoint(
      'GET /logic/code/sales_basic_aggregation',
      () => getLogicCode('sales_basic_aggregation'),
      THRESHOLD_MS,
    );
  });
});
