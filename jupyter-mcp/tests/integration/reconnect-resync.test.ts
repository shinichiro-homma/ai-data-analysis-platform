/**
 * 再接続時の再同期の統合テスト（タスク 21.4）
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 *
 * テスト対象:
 * 1. 切断中の変更が再接続後の照会で検出できる
 * 2. ロック中の sync-state にロック一覧が反映される
 * 3. 認証なしの GET /api/ai/sync-state は 403
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
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
import { jupyterClient } from '../../src/jupyter-client/client.js';

describe('再接続時の再同期の統合テスト', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  let wsClient: WsEventClient;

  const serverUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
  const token = process.env.JUPYTER_TOKEN ?? '';

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();

    // WebSocket クライアント接続
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    wsClient = new WsEventClient(wsUrl, token);
    await wsClient.connect();
    expect(wsClient.isConnected()).toBe(true);
  });

  afterAll(async () => {
    // WebSocket クライアント切断
    if (wsClient) {
      wsClient.disconnect();
    }
  });

  afterEach(async () => {
    // イベントバッファクリア
    if (wsClient) {
      wsClient.clearEvents();
    }

    // セッションクリーンアップ
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    // ワークスペースクリーンアップ
    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;

    // テスト間の状態汚染を防止
    resetCellTracker();
    sessionNotebookStore.clear();
  });

  /** sync-state API を呼び出すヘルパー */
  async function fetchSyncState(): Promise<Record<string, unknown>> {
    const response = await fetch(`${serverUrl}/api/ai/sync-state?token=${token}`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { data: Record<string, unknown> };
    return body.data;
  }

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-resync-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessData = parseToolCallResult(sessResult);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    const notebookName = generateTestNotebookName(testName);
    const nbResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionId,
      name: notebookName,
    });
    const nbData = parseToolCallResult(nbResult);
    const notebookPath = nbData.path as string;

    // notebook_create が発行する notebook_changed をクリア（テスト対象外）
    wsClient.clearEvents();

    return { workspaceId, sessionId, notebookPath };
  }

  test('切断中の変更が再接続後の照会で検出できる', async () => {
    const { sessionId, notebookPath } = await createTestNotebook('disconnect-change');

    // 1. 初回 sync-state で seq を記録
    const initialState = await fetchSyncState();
    const notebooks = initialState.notebooks as Record<string, number>;
    const initialSeq = notebooks[notebookPath.replace(/^\/+/, '')] ?? 0;

    // 2. WS クライアントを切断（切断中の変更をシミュレート）
    wsClient.disconnect();

    // 3. 切断中にセル追加（notebook_changed が発行される）
    const addCellResult = await handleToolCall('notebook_add_cell', {
      notebook_path: notebookPath,
      cell_type: 'code',
      source: 'x = 42',
    });
    const addCellData = parseToolCallResult(addCellResult);
    expect(addCellData.success).toBe(true);

    // 4. 再接続
    const wsUrl = serverUrl.replace(/^http/, 'ws');
    wsClient = new WsEventClient(wsUrl, token);
    await wsClient.connect();
    expect(wsClient.isConnected()).toBe(true);

    // 5. 再接続後の sync-state で seq が増加していることを確認
    const reconnectedState = await fetchSyncState();
    const reconnectedNotebooks = reconnectedState.notebooks as Record<string, number>;
    const newSeq = reconnectedNotebooks[notebookPath.replace(/^\/+/, '')] ?? 0;

    expect(newSeq).toBeGreaterThan(initialSeq);

    // 6. Contents API GET でセルが存在することを確認
    const notebook = await jupyterClient.getContents(notebookPath);
    const cells = notebook.content.cells as Array<{ source: string }>;
    const addedCell = cells.find((c) => c.source === 'x = 42');
    expect(addedCell).toBeDefined();
  });

  test('ロック中の sync-state にロック一覧が反映される', async () => {
    const { notebookPath } = await createTestNotebook('lock-reflect');

    // 1. ロック取得
    const lockResponse = await fetch(`${serverUrl}/api/ai/locks?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebook_path: notebookPath }),
    });
    expect(lockResponse.ok).toBe(true);
    const lockBody = (await lockResponse.json()) as {
      data: { token: string; expires_at: number };
    };
    const lockToken = lockBody.data.token;

    // 2. sync-state にロックが反映されていることを確認
    const stateWithLock = await fetchSyncState();
    const locks = stateWithLock.locks as Array<{
      notebook_path: string;
      expires_at: number;
    }>;
    const normalizedPath = notebookPath.replace(/^\/+/, '');
    const foundLock = locks.find((l) => l.notebook_path === normalizedPath);
    expect(foundLock).toBeDefined();
    expect(foundLock?.expires_at).toBeGreaterThan(0);

    // 3. ロック解放
    const releaseResponse = await fetch(`${serverUrl}/api/ai/locks?token=${token}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Lock-Token': lockToken,
      },
      body: JSON.stringify({ notebook_path: notebookPath }),
    });
    expect(releaseResponse.ok).toBe(true);

    // 4. 解放後の sync-state からロックが消えていることを確認
    const stateAfterRelease = await fetchSyncState();
    const locksAfterRelease = stateAfterRelease.locks as Array<{
      notebook_path: string;
    }>;
    const releasedLock = locksAfterRelease.find((l) => l.notebook_path === normalizedPath);
    expect(releasedLock).toBeUndefined();
  });

  test('認証なしの GET /api/ai/sync-state は 403', async () => {
    // トークンなしで sync-state にアクセス
    const response = await fetch(`${serverUrl}/api/ai/sync-state`);

    // 認証なしは 403 を返す
    expect(response.status).toBe(403);
  });
});
