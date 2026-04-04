/**
 * document-mcp MCP オーバーヘッドテスト
 *
 * MCP ツール呼び出し時間と REST API 直接呼び出し時間を比較し、
 * オーバーヘッドが NF1 要件（50ms 以内）であることを検証する。
 *
 * 前提:
 * - document-server が起動していること（docker-compose up -d）
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { getFixture } from './fixtures/index.js';

const fixture = getFixture();

const DOCUMENT_SERVER_URL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';

const OVERHEAD_THRESHOLD_MS = 50;
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 4;

beforeAll(async () => {
  try {
    const res = await fetch(`${DOCUMENT_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status: ${res.status}`);
  } catch (e) {
    throw new Error(`document-server に接続できません。docker-compose up -d を確認してください。(${e})`);
  }
});

/**
 * REST API 直接呼び出しのヘルパー
 */
async function restFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${DOCUMENT_SERVER_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  return res.json() as Promise<T>;
}

/**
 * MCP ツールとREST直接呼び出しの所要時間をそれぞれ計測し、
 * 差分（オーバーヘッド）が閾値以内であることを検証する。
 */
async function measureOverhead(
  name: string,
  mcpCall: () => Promise<unknown>,
  restCall: () => Promise<unknown>,
  thresholdMs: number,
): Promise<void> {
  // ウォームアップ
  for (let i = 0; i < WARMUP_RUNS; i++) {
    await mcpCall();
    await restCall();
  }

  // 計測
  for (let i = 0; i < MEASURE_RUNS; i++) {
    const restStart = performance.now();
    await restCall();
    const restTime = performance.now() - restStart;

    const mcpStart = performance.now();
    await mcpCall();
    const mcpTime = performance.now() - mcpStart;

    const overhead = mcpTime - restTime;

    expect(
      overhead,
      `${name} の ${i + 1} 回目: オーバーヘッド ${overhead.toFixed(1)}ms (MCP: ${mcpTime.toFixed(1)}ms, REST: ${restTime.toFixed(1)}ms, 閾値: ${thresholdMs}ms)`,
    ).toBeLessThan(thresholdMs);
  }
}

describe('document-mcp MCP オーバーヘッドテスト (NF1: 50ms以内)', () => {
  const detailTable = fixture.tables.detail.tableName;
  const detailTerm = fixture.terms.detail.termName;
  const detailLogic = fixture.logic.detail.logicName;

  it('get_table_index のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_table_index',
      () => handleToolCall('get_table_index', {}),
      () => restFetch('/catalog/index'),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_table_detail のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_table_detail',
      () =>
        handleToolCall('get_table_detail', {
          table_names: [detailTable],
        }),
      () =>
        restFetch('/catalog/tables', {
          method: 'POST',
          body: JSON.stringify({ table_names: [detailTable] }),
        }),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_term_index のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_term_index',
      () => handleToolCall('get_term_index', {}),
      () => restFetch('/glossary/index'),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_term_detail のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_term_detail',
      () =>
        handleToolCall('get_term_detail', {
          term_names: [detailTerm],
        }),
      () =>
        restFetch('/glossary/terms', {
          method: 'POST',
          body: JSON.stringify({ term_names: [detailTerm] }),
        }),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_logic_index のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_logic_index',
      () => handleToolCall('get_logic_index', {}),
      () => restFetch('/logic/index'),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_logic_detail のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_logic_detail',
      () =>
        handleToolCall('get_logic_detail', {
          logic_names: [detailLogic],
        }),
      () =>
        restFetch('/logic/meta', {
          method: 'POST',
          body: JSON.stringify({
            logic_names: [detailLogic],
          }),
        }),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_logic_code のオーバーヘッドが 50ms 以内', async () => {
    await measureOverhead(
      'get_logic_code',
      () =>
        handleToolCall('get_logic_code', {
          logic_name: detailLogic,
        }),
      () => restFetch(`/logic/code/${detailLogic}`),
      OVERHEAD_THRESHOLD_MS,
    );
  });
});
