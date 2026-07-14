/**
 * Phase 21 同期再設計の統合テスト（タスク 21.5）
 *
 * Phase 21 全体（21.1〜21.4）を貫く統合テストシナリオ。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 *
 * シナリオ:
 * 1. ロック強制: ロック取得中の第三者セル操作 PATCH が 423、正トークンは 200
 * 2. TTL 失効（異常系）: release せず TTL 経過後に再 acquire 成功 + lock_released 受信
 * 3. 通知と真実の一致: notebook_add_cell → notebook_changed(seq) → Contents API GET の内容と一致
 * 4. Issue #76（異常系）: WS接続のみ（ブラウザなし）で execute_code → outputs がファイルに存在
 * 5. 再接続再同期（異常系）: 切断中に編集 → 再接続 → GET /api/ai/sync-state の seq 進行を確認
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
import { WsEventClient, AI_EVENT_TYPES } from '../helpers/ws-event-client.js';

const serverUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
const token = process.env.JUPYTER_TOKEN ?? '';

/** パスの先頭スラッシュを除去（ロック・Contents API 用に正規化） */
function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

describe('Phase 21 同期再設計の統合テスト', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  let http: AxiosInstance;
  let wsClient: WsEventClient;

  beforeAll(async () => {
    await checkJupyterConnection();

    http = axios.create({
      baseURL: serverUrl,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-sync-${testName}-${Date.now()}`,
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

  /** sync-state API を呼び出すヘルパー */
  async function fetchSyncState(): Promise<Record<string, unknown>> {
    const response = await fetch(`${serverUrl}/api/ai/sync-state?token=${token}`);
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { data: Record<string, unknown> };
    return body.data;
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

  // ─── シナリオ 1: ロック強制 ──────────────────────────────────
  describe('シナリオ1: ロック強制', () => {
    test('ロック取得中、X-Lock-Token なしの PATCH cells は 423、正トークンでは 200', async () => {
      const { notebookPath } = await createTestNotebook('s1-enforce');

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
  });

  // ─── シナリオ 2: TTL 失効（異常系） ──────────────────────────
  describe('シナリオ2: TTL 失効（異常系）', () => {
    test('release せず TTL 経過後に再 acquire 成功し、lock_released が配信される', async () => {
      const { notebookPath } = await createTestNotebook('s2-ttl');

      // TTL=2 秒でロックを取得（release しない）
      const lock = await jupyterClient.acquireLock(notebookPath, 2);
      expect(lock.lockToken).toBeTruthy();

      // 失効前は再取得できない（423 = NotebookLockedError）
      await expect(jupyterClient.acquireLock(notebookPath)).rejects.toMatchObject({ statusCode: 423 });

      // TTL 失効を待つ（スイーパー間隔 5 秒 + TTL 2 秒を考慮）
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // 失効後は同一パスを再取得できる
      const relock = await jupyterClient.acquireLock(notebookPath);
      expect(relock.lockToken).toBeTruthy();
      expect(relock.lockToken).not.toBe(lock.lockToken);

      // 失効時に lock_released イベントが配信されている
      const released = await wsClient.waitForEventMatching(
        (e) =>
          e.type === AI_EVENT_TYPES.LOCK_RELEASED && normalizePath(e.notebook_path) === normalizePath(notebookPath),
        `lock_released for ${notebookPath}`,
        5000,
      );
      expect(released.type).toBe(AI_EVENT_TYPES.LOCK_RELEASED);
      expect(normalizePath(released.notebook_path)).toBe(normalizePath(notebookPath));

      await jupyterClient.releaseLock(notebookPath, relock.lockToken);
    }, 20000);
  });

  // ─── シナリオ 3: 通知と真実の一致 ──────────────────────────────
  describe('シナリオ3: 通知と真実の一致', () => {
    test('notebook_add_cell → notebook_changed(seq) → Contents API GET の内容と一致', async () => {
      const { notebookPath } = await createTestNotebook('s3-truth');
      const cellSource = 'truth_check = 42';

      // 1. セル追加
      const addResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: cellSource,
      });
      const addData = parseToolCallResult(addResult);
      expect(addData.success).toBe(true);

      // 2. notebook_changed イベントを待機
      const changedEvent = await wsClient.waitForEventMatching(
        (e) =>
          e.type === AI_EVENT_TYPES.NOTEBOOK_CHANGED && normalizePath(e.notebook_path) === normalizePath(notebookPath),
        `notebook_changed for ${notebookPath}`,
        5000,
      );
      expect(typeof changedEvent.seq).toBe('number');
      expect(changedEvent.seq as number).toBeGreaterThan(0);

      // 3. Contents API GET でノートブックの内容を取得し、イベント通知と実態が一致
      const notebook = await jupyterClient.getContents(notebookPath);
      const cells = notebook.content.cells as Array<{ source: string; cell_type: string }>;
      const addedCell = cells.find((c) => c.source === cellSource);
      expect(addedCell).toBeDefined();
      expect(addedCell?.cell_type).toBe('code');
    });
  });

  // ─── シナリオ 4: Issue #76（異常系） ──────────────────────────
  describe('シナリオ4: Issue #76 未オープン時の出力永続化（異常系）', () => {
    test('WS接続のみ（ブラウザなし）で execute_code → outputs がファイルに存在する', async () => {
      // WS クライアントは接続しているがブラウザ（JupyterLab フロントエンド）は未オープン
      // → revert 主体が不在でも outputs がディスクに永続化されることを検証
      expect(wsClient.isConnected()).toBe(true);

      const { sessionId, notebookPath } = await createTestNotebook('s4-issue76');
      const cellSource = 'print("issue76-persist")';

      // 1. セル追加
      const addResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: cellSource,
      });
      expect(parseToolCallResult(addResult).success).toBe(true);

      // 2. コード実行
      const execResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: cellSource,
      });
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(true);

      // 3. ディスク上のノートブックを検証 — outputs がファイルに存在する
      const notebook = await jupyterClient.getContents(notebookPath);
      const cells = notebook.content.cells as Array<{
        source: string;
        outputs: Array<{ output_type: string; text?: string[] }>;
      }>;
      const execCell = cells.find((c) => c.source === cellSource);
      expect(execCell).toBeDefined();
      expect(execCell!.outputs.length).toBeGreaterThan(0);

      // stdout 出力が含まれていることを確認
      const streamOutput = execCell!.outputs.find((o) => o.output_type === 'stream');
      expect(streamOutput).toBeDefined();
    });
  });

  // ─── シナリオ 5: 再接続再同期（異常系） ──────────────────────
  describe('シナリオ5: 再接続再同期（異常系）', () => {
    test('切断中に編集 → 再接続 → GET /api/ai/sync-state の seq 進行を確認', async () => {
      const { notebookPath } = await createTestNotebook('s5-resync');
      const normalizedPath = normalizePath(notebookPath);

      // 1. 初回 sync-state で seq を記録
      const initialState = await fetchSyncState();
      const notebooks = initialState.notebooks as Record<string, number>;
      const initialSeq = notebooks[normalizedPath] ?? 0;

      // 2. WS クライアントを切断（切断中の変更をシミュレート）
      wsClient.disconnect();

      // 3. 切断中にセル追加（notebook_changed が発行されるがクライアントは受信しない）
      const addResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'disconnected_edit = True',
      });
      expect(parseToolCallResult(addResult).success).toBe(true);

      // 4. 再接続
      const wsUrl = serverUrl.replace(/^http/, 'ws');
      wsClient = new WsEventClient(wsUrl, token);
      await wsClient.connect();
      expect(wsClient.isConnected()).toBe(true);

      // 5. 再接続後の sync-state で seq が増加していることを確認
      const reconnectedState = await fetchSyncState();
      const reconnectedNotebooks = reconnectedState.notebooks as Record<string, number>;
      const newSeq = reconnectedNotebooks[normalizedPath] ?? 0;
      expect(newSeq).toBeGreaterThan(initialSeq);

      // 6. Contents API GET でセルが存在することを確認
      const notebook = await jupyterClient.getContents(notebookPath);
      const cells = notebook.content.cells as Array<{ source: string }>;
      const addedCell = cells.find((c) => c.source === 'disconnected_edit = True');
      expect(addedCell).toBeDefined();
    });
  });
});
