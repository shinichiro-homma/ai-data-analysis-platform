/**
 * AI同期フローの統合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 *
 * このテストでは、jupyter-mcp から MCPツールを実行し、
 * jupyter-server の AI同期WebSocketエンドポイント (/api/ai/events) に
 * イベントが正しく配信されることを検証する。
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

describe('AI同期フローの統合テスト', () => {
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
    wsClient.clearEvents();

    // セッションクリーンアップ
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    // ワークスペースクリーンアップ（ノートブックも含めて削除）
    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;

    // テスト間の状態汚染を防止
    resetCellTracker();
    sessionNotebookStore.clear();
  });

  /** パスの先頭スラッシュを正規化（イベントのパスと比較用） */
  function normalizePath(path: string): string {
    return path.replace(/^\/+/, '');
  }

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-aisync-${testName}-${Date.now()}`,
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

    return { workspaceId, sessionId, notebookPath };
  }

  describe('セル追加のリアルタイム同期', () => {
    test('notebook_add_cell → cell_added イベントが配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-add-sync');

      // 1. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 2. cell_added イベントを待機
      const event = await wsClient.waitForEvent('cell_added', 5000);

      // 3. イベントの検証
      expect(event.type).toBe('cell_added');
      expect(normalizePath(event.notebook_path as string)).toBe(normalizePath(notebookPath));
    });

    test('cell_added イベントのペイロードが正しい', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-add-payload');

      // 1. セル追加
      const cellSource = 'import pandas as pd';
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: cellSource,
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 2. イベント待機・検証
      const event = await wsClient.waitForEvent('cell_added', 5000);

      expect(normalizePath(event.notebook_path as string)).toBe(normalizePath(notebookPath));
      // @ts-expect-error - cell プロパティの型定義
      expect(event.cell?.cell_type).toBe('code');
      // @ts-expect-error - cell プロパティの型定義
      expect(event.cell?.source).toBe(cellSource);
      // @ts-expect-error - index プロパティの型定義
      expect(typeof event.index).toBe('number');
    });

    test('clients > 0 でもセルがディスクに永続化される', async () => {
      // WebSocket クライアントが接続中 → clients > 0
      expect(wsClient.isConnected()).toBe(true);

      const { sessionId, notebookPath } = await createTestNotebook('cell-persist-disk');

      // 1. セル追加（clients > 0 の状態）
      const cellSource = 'print("persisted to disk")';
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: cellSource,
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 2. ディスク上のノートブック内容を確認
      const notebook = await jupyterClient.getContents(notebookPath);
      const cells = notebook.content.cells;

      // 追加したセルがディスクに存在することを検証
      const addedCell = cells.find((c) => c.source === cellSource);
      expect(addedCell).toBeDefined();
      expect(addedCell?.cell_type).toBe('code');
    });
  });

  describe('セル実行のリアルタイム同期', () => {
    test('execute_code → cell_execute_start, cell_output, cell_execute_end イベントが配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-exec-sync');

      // 1. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("hello")',
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 2. cell_added イベントをクリア（セル実行イベントのみをテストするため）
      wsClient.clearEvents();

      // 3. コード実行
      const executeResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'print("hello")',
      });
      const executeData = parseToolCallResult(executeResult);
      expect(executeData.success).toBe(true);

      // 4. イベントを順序付きで待機
      const events = await wsClient.waitForEvents(['cell_execute_start', 'cell_output', 'cell_execute_end'], 10000);

      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('cell_execute_start');
      expect(events[1].type).toBe('cell_output');
      expect(events[2].type).toBe('cell_execute_end');
    });

    test('stdout 出力が cell_output イベントで配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-exec-stdout');

      // 1. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("hello world")',
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      wsClient.clearEvents();

      // 2. コード実行
      const executeResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'print("hello world")',
      });
      const executeData = parseToolCallResult(executeResult);
      expect(executeData.success).toBe(true);

      // 3. cell_output イベント待機
      const events = await wsClient.waitForEvents(['cell_execute_start', 'cell_output', 'cell_execute_end'], 10000);

      const outputEvent = events.find((e) => e.type === 'cell_output');
      expect(outputEvent).toBeDefined();
      // @ts-expect-error - output プロパティの型定義
      expect(outputEvent?.output?.output_type).toBe('stream');
      // @ts-expect-error - output プロパティの型定義
      expect(outputEvent?.output?.name).toBe('stdout');
      // @ts-expect-error - output プロパティの型定義
      expect(outputEvent?.output?.text).toBe('hello world\n');
    });

    test('エラー出力が cell_output イベントで配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-exec-error');

      // 1. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: '1/0',
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      wsClient.clearEvents();

      // 2. エラーコード実行
      const executeResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: '1/0',
      });
      const executeData = parseToolCallResult(executeResult);
      expect(executeData.success).toBe(false);

      // 3. cell_output イベント待機
      const events = await wsClient.waitForEvents(['cell_execute_start', 'cell_output', 'cell_execute_end'], 10000);

      const outputEvent = events.find((e) => e.type === 'cell_output');
      expect(outputEvent).toBeDefined();
      // @ts-expect-error - output プロパティの型定義
      expect(outputEvent?.output?.output_type).toBe('error');
      // @ts-expect-error - output プロパティの型定義
      expect(outputEvent?.output?.ename).toBe('ZeroDivisionError');
    });

    test('画像出力が execute_code レスポンスの images 配列に含まれる', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('cell-exec-image');

      const matplotlibCode = `
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 2, 3])
plt.show()
      `.trim();

      // 1. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: matplotlibCode,
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 2. matplotlib コード実行
      const executeResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: matplotlibCode,
      });
      const executeData = parseToolCallResult(executeResult);
      expect(executeData.success).toBe(true);

      // 3. images 配列に画像が含まれることを確認
      // display_data はカーネルの WebSocket 経由で直接 JupyterLab に配信されるため、
      // cell_output イベントには含まれない（buildNotebookOutputs の設計）
      expect(executeData.images).toBeDefined();
      expect(executeData.images.length).toBeGreaterThanOrEqual(1);
      expect(executeData.images[0].file_path).toBeDefined();
      expect(executeData.images[0].mime_type).toBe('image/png');
    }, 15000); // matplotlib の初期化に時間がかかる可能性があるため、タイムアウトを延長
  });

  describe('AI編集モード（ロック制御）', () => {
    test('ai_edit_start → ai_edit_start イベントが配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('lock-start');

      // 1. AI編集開始
      const editStartResult = await handleToolCall('ai_edit_start', {
        session_id: sessionId,
      });
      const editStartData = parseToolCallResult(editStartResult);
      expect(editStartData.success).toBe(true);

      // 2. ai_edit_start イベント待機
      const event = await wsClient.waitForEvent('ai_edit_start', 5000);

      expect(event.type).toBe('ai_edit_start');
      expect(normalizePath(event.notebook_path as string)).toBe(normalizePath(notebookPath));
    });

    test('ai_edit_end → ai_edit_end イベントが配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('lock-end');

      // 1. AI編集開始
      const editStartResult = await handleToolCall('ai_edit_start', {
        session_id: sessionId,
      });
      const editStartData = parseToolCallResult(editStartResult);
      expect(editStartData.success).toBe(true);

      await wsClient.waitForEvent('ai_edit_start', 5000);
      wsClient.clearEvents();

      // 2. AI編集終了
      const editEndResult = await handleToolCall('ai_edit_end', {
        session_id: sessionId,
      });
      const editEndData = parseToolCallResult(editEndResult);
      expect(editEndData.success).toBe(true);

      // 3. ai_edit_end イベント待機
      const event = await wsClient.waitForEvent('ai_edit_end', 5000);

      expect(event.type).toBe('ai_edit_end');
      expect(normalizePath(event.notebook_path as string)).toBe(normalizePath(notebookPath));
    });

    test('イベントの notebook_path が正しい', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('lock-notebook-path');

      // 1. AI編集開始→終了
      await handleToolCall('ai_edit_start', { session_id: sessionId });
      const startEvent = await wsClient.waitForEvent('ai_edit_start', 5000);
      expect(normalizePath(startEvent.notebook_path as string)).toBe(normalizePath(notebookPath));

      await handleToolCall('ai_edit_end', { session_id: sessionId });
      const endEvent = await wsClient.waitForEvent('ai_edit_end', 5000);
      expect(normalizePath(endEvent.notebook_path as string)).toBe(normalizePath(notebookPath));
    });
  });

  describe('E2Eフロー: ロック→セル追加→実行→アンロック', () => {
    test('完全フローで全イベントが正しい順序で配信される', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('e2e-flow');

      // 1. AI編集開始
      const editStartResult = await handleToolCall('ai_edit_start', {
        session_id: sessionId,
      });
      const editStartData = parseToolCallResult(editStartResult);
      expect(editStartData.success).toBe(true);

      // 2. セル追加
      const addCellResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("hello")',
      });
      const addCellData = parseToolCallResult(addCellResult);
      expect(addCellData.success).toBe(true);

      // 3. コード実行
      const executeResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'print("hello")',
      });
      const executeData = parseToolCallResult(executeResult);
      expect(executeData.success).toBe(true);

      // 4. AI編集終了
      const editEndResult = await handleToolCall('ai_edit_end', {
        session_id: sessionId,
      });
      const editEndData = parseToolCallResult(editEndResult);
      expect(editEndData.success).toBe(true);

      // 5. 全イベントを順序付きで待機
      const events = await wsClient.waitForEvents(
        ['ai_edit_start', 'cell_added', 'cell_execute_start', 'cell_output', 'cell_execute_end', 'ai_edit_end'],
        15000,
      );

      // 6. イベント順序の検証
      expect(events).toHaveLength(6);
      expect(events[0].type).toBe('ai_edit_start');
      expect(events[1].type).toBe('cell_added');
      expect(events[2].type).toBe('cell_execute_start');
      expect(events[3].type).toBe('cell_output');
      expect(events[4].type).toBe('cell_execute_end');
      expect(events[5].type).toBe('ai_edit_end');

      // 7. すべてのイベントで notebook_path が一致
      events.forEach((event) => {
        expect(normalizePath(event.notebook_path as string)).toBe(normalizePath(notebookPath));
      });
    }, 20000); // E2Eフローは時間がかかる可能性があるため、タイムアウトを延長

    test('複数セル追加・実行のフロー', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('e2e-multiple');

      // 1. AI編集開始
      await handleToolCall('ai_edit_start', { session_id: sessionId });

      // 2. セル1追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'import pandas as pd',
      });

      // 3. セル2追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("test")',
      });

      // 4. セル1実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'import pandas as pd',
      });

      // 5. セル2実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'print("test")',
      });

      // 6. AI編集終了
      await handleToolCall('ai_edit_end', { session_id: sessionId });

      // 7. 全イベントを順序付きで待機
      const events = await wsClient.waitForEvents(
        [
          'ai_edit_start',
          'cell_added', // セル1
          'cell_added', // セル2
          'cell_execute_start', // セル1実行開始
          'cell_execute_end', // セル1実行完了
          'cell_execute_start', // セル2実行開始
          'cell_output', // セル2出力
          'cell_execute_end', // セル2実行完了
          'ai_edit_end',
        ],
        20000,
      );

      // 8. イベント数の検証
      expect(events.length).toBeGreaterThanOrEqual(9);

      // 9. 最初と最後のイベントを検証
      expect(events[0].type).toBe('ai_edit_start');
      expect(events[events.length - 1].type).toBe('ai_edit_end');

      // 10. cell_added イベントが2回ある
      const cellAddedEvents = events.filter((e) => e.type === 'cell_added');
      expect(cellAddedEvents).toHaveLength(2);

      // 11. cell_execute_start イベントが2回ある
      const executeStartEvents = events.filter((e) => e.type === 'cell_execute_start');
      expect(executeStartEvents).toHaveLength(2);
    }, 25000); // 複数セルフローは時間がかかるため、タイムアウトをさらに延長
  });
});
