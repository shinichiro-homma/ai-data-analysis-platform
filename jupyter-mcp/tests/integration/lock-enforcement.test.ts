/**
 * ノートブックロックのサーバー側強制 統合テスト（タスク 21.2）
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 *
 * 検証内容（完了条件）:
 * 1. ロック取得中に X-Lock-Token なしの PATCH cells が 423 を返し、正トークンでは 200 を返す
 * 2. TTL 失効: TTL を過ぎてロックが失効すると同一パスを再取得でき、lock_released が配信される
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { resetCellTracker } from '../../src/utils/notebook-cell-tracker.js';
import { sessionNotebookStore } from '../../src/utils/session-notebook-store.js';
import {
  generateTestNotebookName,
  cleanupSession,
  cleanupWorkspace,
  checkJupyterConnection,
  parseToolCallResult,
} from '../setup.js';
import { WsEventClient } from '../helpers/ws-event-client.js';

const serverUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
const token = process.env.JUPYTER_TOKEN ?? '';

/** パスの先頭スラッシュを除去（ロック・Contents API 用に正規化） */
function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

describe('ノートブックロックのサーバー側強制 統合テスト', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  let http: AxiosInstance;
  let wsClient: WsEventClient;

  beforeAll(async () => {
    await checkJupyterConnection();

    http = axios.create({
      baseURL: serverUrl,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // 4xx を例外にせず自前で判定する
      validateStatus: () => true,
    });

    const wsUrl = serverUrl.replace(/^http/, 'ws');
    wsClient = new WsEventClient(wsUrl, token);
    await wsClient.connect();
    expect(wsClient.isConnected()).toBe(true);
  });

  afterAll(() => {
    if (wsClient) {
      wsClient.disconnect();
    }
  });

  afterEach(async () => {
    wsClient.clearEvents();

    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;

    resetCellTracker();
    sessionNotebookStore.clear();
  });

  /** テスト用ワークスペース+セッション+ノートブックを作成する */
  async function createTestNotebook(testName: string): Promise<string> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-lock-${testName}-${Date.now()}`,
    });
    const workspaceId = parseToolCallResult(wsResult).workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessResult = await handleToolCall('session_create', { workspace_id: workspaceId });
    const sessionId = parseToolCallResult(sessResult).session_id as string;
    createdSessionIds.push(sessionId);

    const nbResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionId,
      name: generateTestNotebookName(testName),
    });
    return normalizePath(parseToolCallResult(nbResult).path as string);
  }

  /** PATCH /api/custom/contents/{path}/cells を任意のヘッダーで直接呼ぶ */
  async function patchAddCell(notebookPath: string, lockToken?: string): Promise<number> {
    const headers: Record<string, string> = {};
    if (lockToken !== undefined) {
      headers['X-Lock-Token'] = lockToken;
    }
    const response = await http.patch(
      `/api/custom/contents/${encodeURIComponent(notebookPath)}/cells`,
      { action: 'add', cell: { cell_type: 'code', source: 'x = 1' } },
      { headers },
    );
    return response.status;
  }

  test('ロック取得中、X-Lock-Token なしの PATCH cells は 423、正トークンでは 200', async () => {
    const notebookPath = await createTestNotebook('enforce');

    // ロックを取得
    const lock = await jupyterClient.acquireLock(notebookPath);
    expect(lock.lockToken).toBeTruthy();

    try {
      // トークンなし → 423
      const statusWithout = await patchAddCell(notebookPath);
      expect(statusWithout).toBe(423);

      // 正トークン → 200
      const statusWith = await patchAddCell(notebookPath, lock.lockToken);
      expect(statusWith).toBe(200);
    } finally {
      await jupyterClient.releaseLock(notebookPath, lock.lockToken);
    }
  });

  test('ロック機構有効下で notebook_add_cell の実プロダクション経路が成功する（自己ロックアウトしない）', async () => {
    // バグ 1 の回帰テスト: withNotebookLock がロックを取得した状態で、
    // 同じ実行フローの書き込み（PATCH cells）が X-Lock-Token 伝播により 423 にならず成功すること。
    const workspaceId = parseToolCallResult(
      await handleToolCall('workspace_create', { name: `test-lock-selflock-${Date.now()}` }),
    ).workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessionId = parseToolCallResult(await handleToolCall('session_create', { workspace_id: workspaceId }))
      .session_id as string;
    createdSessionIds.push(sessionId);

    const notebookPath = normalizePath(
      parseToolCallResult(
        await handleToolCall('notebook_create', {
          workspace_id: workspaceId,
          session_id: sessionId,
          name: generateTestNotebookName('selflock'),
        }),
      ).path as string,
    );

    // handleToolCall 経由（= withNotebookLock で包まれる実経路）でセルを追加する。
    // ロックを取得しつつ自身の書き込みが通ることを検証する。
    const addResult = await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'x = 1',
    });
    const parsed = parseToolCallResult(addResult);
    // NOTEBOOK_LOCKED エラーにならず成功していること
    expect((parsed as { error?: unknown }).error).toBeUndefined();
  });

  test('TTL 失効後は同一パスを再取得でき、lock_released が配信される', async () => {
    const notebookPath = await createTestNotebook('ttl-expiry');

    // TTL=2 秒でロックを取得（release しない）
    const lock = await jupyterClient.acquireLock(notebookPath, 2);
    expect(lock.lockToken).toBeTruthy();

    // 失効前は再取得できない（423 = NotebookLockedError）
    await expect(jupyterClient.acquireLock(notebookPath)).rejects.toMatchObject({ statusCode: 423 });

    // TTL 失効を待つ（スイーパー間隔 5 秒 + TTL 2 秒を考慮して待機）
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // 失効後は同一パスを再取得できる
    const relock = await jupyterClient.acquireLock(notebookPath);
    expect(relock.lockToken).toBeTruthy();
    expect(relock.lockToken).not.toBe(lock.lockToken);

    // 失効時に lock_released イベントが配信されている
    const released = await wsClient.waitForEvent('lock_released', 5000);
    expect(normalizePath(released.notebook_path)).toBe(notebookPath);

    await jupyterClient.releaseLock(notebookPath, relock.lockToken);
  }, 20000);
});
