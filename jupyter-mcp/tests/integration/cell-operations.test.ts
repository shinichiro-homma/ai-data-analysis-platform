/**
 * セル操作の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 *
 * 対象ツール:
 * - notebook_list_cells
 * - notebook_edit_cell
 * - notebook_delete_cell
 * - notebook_execute_cell
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

describe('セル操作の結合テスト', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;

    // テスト間の状態汚染を防止
    resetCellTracker();
    sessionNotebookStore.clear();
  });

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-cellops-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessData = parseToolCallResult(sessResult);
    expect(sessData.success).toBe(true);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    const notebookName = generateTestNotebookName(testName);
    const nbResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionId,
      name: notebookName,
    });
    const nbData = parseToolCallResult(nbResult);
    expect(nbData.success).toBe(true);
    const notebookPath = nbData.path as string;

    return { workspaceId, sessionId, notebookPath };
  }

  describe('セル操作の基本フロー', () => {
    test('セル追加後に notebook_list_cells で一覧取得できる', async () => {
      const { notebookPath } = await createTestNotebook('list-cells');

      // 1. セルを追加
      const addResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 42',
      });
      const addData = parseToolCallResult(addResult);
      expect(addData.success).toBe(true);

      // 2. notebook_list_cells でセル一覧を取得
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      expect(listData.success).toBe(true);
      expect(typeof listData.total_cells).toBe('number');
      expect(listData.total_cells as number).toBeGreaterThanOrEqual(1);

      // 3. 追加したセルが含まれることを確認
      const cells = listData.cells as Array<{
        cell_index: number;
        cell_type: string;
        source: string;
      }>;
      const addedCell = cells.find((c) => c.source === 'x = 42');
      expect(addedCell).toBeDefined();
      expect(addedCell?.cell_type).toBe('code');
    });

    test('notebook_edit_cell でセルソースを変更できる', async () => {
      const { notebookPath } = await createTestNotebook('edit-cell');

      // 1. セルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'original = 1',
      });

      // 2. セルを編集
      const editResult = await handleToolCall('notebook_edit_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        source: 'edited = 2',
      });
      const editData = parseToolCallResult(editResult);
      expect(editData.success).toBe(true);

      // 3. セル一覧で変更が反映されていることを確認
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ cell_index: number; cell_type: string; source: string }>;
      const editedCell = cells.find((c) => c.cell_index === 0);
      expect(editedCell?.source).toBe('edited = 2');
    });

    test('notebook_execute_cell でセルを再実行できる', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('execute-cell');

      // 1. コードセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("hello from cell")',
      });

      // 2. セルを実行
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
      });
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(true);
      expect(execData.cell_index).toBe(0);
      expect(execData.stdout).toContain('hello from cell');
    }, 15000);

    test('notebook_delete_cell でセルを削除できる', async () => {
      const { notebookPath } = await createTestNotebook('delete-cell');

      // 1. 2つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_to_keep = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_to_delete = 2',
      });

      // 2. 追加前の状態を確認（2セル）
      const listBefore = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const beforeData = parseToolCallResult(listBefore);
      expect(beforeData.total_cells).toBe(2);

      // 3. セル1（cell_to_delete）を削除
      const deleteResult = await handleToolCall('notebook_delete_cell', {
        notebook_path: notebookPath,
        cell_index: 1,
      });
      const deleteData = parseToolCallResult(deleteResult);
      expect(deleteData.success).toBe(true);

      // 4. 削除後のセル一覧を確認（1セル）
      const listAfter = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const afterData = parseToolCallResult(listAfter);
      expect(afterData.total_cells).toBe(1);
      const remainingCells = afterData.cells as Array<{ source: string }>;
      expect(remainingCells[0].source).toBe('cell_to_keep = 1');
    });
  });

  describe('セル操作のエラーハンドリング', () => {
    test('範囲外 cell_index で edit → エラー', async () => {
      const { notebookPath } = await createTestNotebook('edit-out-of-range');

      // 1. セルを1つ追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });

      // 2. 範囲外インデックスで編集
      const editResult = await handleToolCall('notebook_edit_cell', {
        notebook_path: notebookPath,
        cell_index: 999,
        source: 'y = 2',
      });
      const editData = parseToolCallResult(editResult);
      expect(editData.success).toBe(false);
    });

    test('範囲外 cell_index で delete → エラー', async () => {
      const { notebookPath } = await createTestNotebook('delete-out-of-range');

      // 1. セルを1つ追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });

      // 2. 範囲外インデックスで削除
      const deleteResult = await handleToolCall('notebook_delete_cell', {
        notebook_path: notebookPath,
        cell_index: 999,
      });
      const deleteData = parseToolCallResult(deleteResult);
      expect(deleteData.success).toBe(false);
    });

    test('範囲外 cell_index で execute → エラー', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('execute-out-of-range');

      // 1. セルを1つ追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });

      // 2. 範囲外インデックスで実行
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 999,
      });
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(false);
    });
  });

  describe('セル追加→一覧→編集→再実行→削除の一連フロー', () => {
    test('完全な CRUD フロー（追加→一覧→編集→再実行→削除の全ステップ）', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('crud-flow');

      // 1. セルを追加
      const addResult = await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'result = 1 + 1',
      });
      expect(parseToolCallResult(addResult).success).toBe(true);

      // 2. 一覧取得で存在を確認
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      expect(listData.success).toBe(true);
      expect(listData.total_cells).toBe(1);
      const cells = listData.cells as Array<{ source: string }>;
      expect(cells[0].source).toBe('result = 1 + 1');

      // 3. セルを編集
      const editResult = await handleToolCall('notebook_edit_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        source: 'result = 2 + 2\nprint(result)',
      });
      expect(parseToolCallResult(editResult).success).toBe(true);

      // 4. 編集後の内容を確認
      const listAfterEdit = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const editedCells = parseToolCallResult(listAfterEdit).cells as Array<{ source: string }>;
      expect(editedCells[0].source).toBe('result = 2 + 2\nprint(result)');

      // 5. セルを再実行
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
      });
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(true);
      expect(execData.stdout).toContain('4');

      // 6. セルを削除
      const deleteResult = await handleToolCall('notebook_delete_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
      });
      expect(parseToolCallResult(deleteResult).success).toBe(true);

      // 7. 削除後にセルが0件になることを確認
      const listAfterDelete = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const afterDeleteData = parseToolCallResult(listAfterDelete);
      expect(afterDeleteData.total_cells).toBe(0);
    }, 20000);
  });

  describe.skip('AI編集モード中のセル操作リアルタイム同期', () => {
    // notebook_edit_cell / notebook_delete_cell / notebook_execute_cell は
    // postAiEvent を呼び出していない（型定義に cell_edited / cell_deleted が存在しないため）。
    // 将来的にAI同期対応が追加された際に有効化すること。

    const serverUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
    const token = process.env.JUPYTER_TOKEN ?? '';

    let wsClient: WsEventClient;

    beforeAll(async () => {
      const wsUrl = serverUrl.replace(/^http/, 'ws');
      wsClient = new WsEventClient(wsUrl, token);
      await wsClient.connect();
    });

    afterAll(async () => {
      if (wsClient) {
        wsClient.disconnect();
      }
    });

    test.skip('完全フロー中の全イベント順序（AI同期対応後に有効化）', async () => {
      // notebook_edit_cell / notebook_delete_cell / notebook_execute_cell が
      // AI同期イベント（cell_edited / cell_deleted 等）を送信するようになった際に実装する。
    });

    test.skip('edit 時の cell_edited イベント（AI同期対応後に有効化）', async () => {
      // notebook_edit_cell が cell_edited イベントを postAiEvent で送信するようになった際に実装する。
    });

    test.skip('delete 時の cell_deleted イベント（AI同期対応後に有効化）', async () => {
      // notebook_delete_cell が cell_deleted イベントを postAiEvent で送信するようになった際に実装する。
    });

    test.skip('execute 時の実行イベント3種（start/output/end）（AI同期対応後に有効化）', async () => {
      // notebook_execute_cell が cell_execute_start / cell_output / cell_execute_end イベントを
      // postAiEvent で送信するようになった際に実装する。
      // 現在は execute_code ツール経由の実行のみAI同期イベントが送信される。
    });
  });
});
