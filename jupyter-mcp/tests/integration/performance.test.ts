/**
 * jupyter-mcp MCP オーバーヘッドテスト
 *
 * MCP ツール呼び出し時間と REST API 直接呼び出し時間を比較し、
 * オーバーヘッドが NF1 要件（100ms 以内）であることを検証する。
 *
 * 前提:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { checkJupyterConnection, cleanupSession, cleanupWorkspace, parseToolCallResult } from '../setup.js';

const JUPYTER_SERVER_URL = process.env.JUPYTER_SERVER_URL || 'http://localhost:8888';
const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';

const JUPYTER_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...(JUPYTER_TOKEN ? { Authorization: `Bearer ${JUPYTER_TOKEN}` } : {}),
};

const OVERHEAD_THRESHOLD_MS = 100;
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 4;

/**
 * REST API 直接呼び出しのヘルパー
 */
async function restFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${JUPYTER_SERVER_URL}${path}`, {
    ...options,
    headers: { ...JUPYTER_HEADERS, ...options?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  return res.json() as Promise<T>;
}

async function restDelete(path: string): Promise<void> {
  try {
    await fetch(`${JUPYTER_SERVER_URL}${path}`, {
      method: 'DELETE',
      headers: JUPYTER_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // クリーンアップのエラーは無視
  }
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

  // 計測（1回目はコールドスタートの影響を受けやすいため検証をスキップ）
  for (let i = 0; i < MEASURE_RUNS; i++) {
    const restStart = performance.now();
    await restCall();
    const restTime = performance.now() - restStart;

    const mcpStart = performance.now();
    await mcpCall();
    const mcpTime = performance.now() - mcpStart;

    const overhead = mcpTime - restTime;

    if (i === 0) {
      console.log(
        `${name} の 1 回目（コールドスタート除外）: オーバーヘッド ${overhead.toFixed(1)}ms (MCP: ${mcpTime.toFixed(1)}ms, REST: ${restTime.toFixed(1)}ms)`,
      );
    } else {
      expect(
        overhead,
        `${name} の ${i + 1} 回目: オーバーヘッド ${overhead.toFixed(1)}ms (MCP: ${mcpTime.toFixed(1)}ms, REST: ${restTime.toFixed(1)}ms, 閾値: ${thresholdMs}ms)`,
      ).toBeLessThan(thresholdMs);
    }
  }
}

describe('jupyter-mcp MCP オーバーヘッドテスト (NF1: 100ms以内)', () => {
  let workspaceId: string | null = null;
  let sessionId: string | null = null;
  let kernelId: string | null = null;

  // 追加で作成されたリソースのクリーンアップ用
  const createdWorkspaceIds: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();

    // テスト用のワークスペースとセッションを事前に作成
    const wsResult = await handleToolCall('workspace_create', {
      name: `perf-test-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    workspaceId = wsData.workspace_id as string;

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessData = parseToolCallResult(sessResult);
    sessionId = sessData.session_id as string;
    kernelId = sessData.kernel_id as string;
  });

  afterAll(async () => {
    // ウォームアップ/計測で作られた追加リソースをクリーンアップ
    for (const sid of createdSessionIds) {
      await cleanupSession(sid);
    }
    for (const wid of createdWorkspaceIds) {
      await cleanupWorkspace(wid);
    }

    // メインのリソースをクリーンアップ
    if (sessionId) await cleanupSession(sessionId);
    if (workspaceId) await cleanupWorkspace(workspaceId);
  });

  it('file_list のオーバーヘッドが 100ms 以内', async () => {
    await measureOverhead(
      'file_list',
      () => handleToolCall('file_list', { workspace_id: workspaceId }),
      () => restFetch(`/api/custom/contents/${workspaceId}`),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('session_list のオーバーヘッドが 100ms 以内', async () => {
    await measureOverhead(
      'session_list',
      () => handleToolCall('session_list', {}),
      () => restFetch('/api/kernels'),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('get_variables のオーバーヘッドが 100ms 以内', async () => {
    // 変数を1つ作成しておく
    await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'perf_test_var = 42',
    });

    await measureOverhead(
      'get_variables',
      () => handleToolCall('get_variables', { session_id: sessionId }),
      () =>
        restFetch(`/api/kernels/${encodeURIComponent(kernelId!)}/execute`, {
          method: 'POST',
          body: JSON.stringify({
            code: "__import__('json').dumps({name: str(type(perf_test_var).__name__) for name in dir() if not name.startswith('_')})",
            timeout: 10,
          }),
        }),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('execute_code のオーバーヘッドが 100ms 以内', async () => {
    await measureOverhead(
      'execute_code',
      () =>
        handleToolCall('execute_code', {
          session_id: sessionId,
          code: '1 + 1',
        }),
      () =>
        restFetch(`/api/kernels/${encodeURIComponent(kernelId!)}/execute`, {
          method: 'POST',
          body: JSON.stringify({ code: '1 + 1', timeout: 10 }),
        }),
      OVERHEAD_THRESHOLD_MS,
    );
  });

  it('workspace_create のオーバーヘッドが 100ms 以内', async () => {
    // workspace_create は副作用があるため、作成後にクリーンアップが必要
    let mcpCounter = 0;
    let restCounter = 0;

    await measureOverhead(
      'workspace_create',
      async () => {
        const name = `perf-mcp-${Date.now()}-${mcpCounter++}`;
        const result = await handleToolCall('workspace_create', { name });
        const data = parseToolCallResult(result);
        createdWorkspaceIds.push(data.workspace_id as string);
      },
      async () => {
        const name = `perf-rest-${Date.now()}-${restCounter++}`;
        const res = await restFetch<{ data: { workspace_id: string } }>('/api/workspaces', {
          method: 'POST',
          body: JSON.stringify({ name }),
        });
        createdWorkspaceIds.push(res.data.workspace_id);
      },
      OVERHEAD_THRESHOLD_MS,
    );
  });
});
