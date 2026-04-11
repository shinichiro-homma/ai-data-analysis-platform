/**
 * Phase 19 ノートブック操作拡張の結合テスト
 *
 * 対象ツール:
 * - notebook_execute_batch (19.1)
 * - notebook_merge_cells (19.2)
 * - notebook_split_cell (19.2)
 * - notebook_change_cell_type (19.3)
 * - notebook_copy_cell (19.4)
 * - notebook_clear_outputs (19.5)
 * - kernel_restart (19.6)
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
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
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { resolveKernelId } from '../../src/utils/session-resolver.js';

describe('Phase 19 ノートブック操作拡張 結合テスト', () => {
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

    resetCellTracker();
    sessionNotebookStore.clear();
  });

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-p19-${testName}-${Date.now()}`,
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

  // ======================================================
  // A. notebook_execute_batch 結合テスト
  // ======================================================

  describe('A. notebook_execute_batch 結合テスト', () => {
    test('A-1: mode: all で全セル実行', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('batch-a1');

      // 3つのコードセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 10',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'y = 20',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print(x + y)',
      });

      // mode: all で全セル実行
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      expect(batchData.executed_cells).toBe(3);
      expect(batchData.success_count).toBe(3);
      expect(batchData.failed_cell).toBeNull();
    }, 30000);

    test('A-2: mode: up_to で指定セルまで実行', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('batch-a2');

      // 3つのコードセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'a = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'b = 2',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'c = 3',
      });

      // mode: up_to でセル1まで実行（セル0、セル1のみ実行）
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'up_to',
        cell_index: 1,
      });
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      expect(batchData.executed_cells).toBe(2);
      expect(batchData.success_count).toBe(2);
    }, 30000);

    test('A-3: mode: from で指定セル以降を実行', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('batch-a3');

      // 3つのコードセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'd = 4',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'e = 5',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'f = 6',
      });

      // mode: from でセル1以降を実行（セル1、セル2のみ実行）
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'from',
        cell_index: 1,
      });
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      expect(batchData.executed_cells).toBe(2);
      expect(batchData.success_count).toBe(2);
    }, 30000);

    test('A-4: Markdown セルのスキップ', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('batch-a4');

      // code → markdown → code の混在セルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'val1 = 100',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'markdown',
        source: '# This is a markdown cell',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'val2 = 200',
      });

      // mode: all で全セル実行（markdown はスキップされる）
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      // markdown がスキップされるので、実行されたセルは 2 つ
      expect(batchData.executed_cells).toBe(2);
      expect(batchData.success_count).toBe(2);
    }, 30000);
  });

  // ======================================================
  // B. notebook_merge_cells / notebook_split_cell 結合テスト
  // ======================================================

  describe('B. notebook_merge_cells / notebook_split_cell 結合テスト', () => {
    test('B-1: セル結合', async () => {
      const { notebookPath } = await createTestNotebook('merge-b1');

      // 2つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'line_a = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'line_b = 2',
      });

      // セル0とセル1を結合
      const mergeResult = await handleToolCall('notebook_merge_cells', {
        notebook_path: notebookPath,
        start_index: 0,
        end_index: 1,
      });
      const mergeData = parseToolCallResult(mergeResult);
      expect(mergeData.success).toBe(true);

      // 結合後のセル一覧を確認（1つに減る）
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      expect(listData.success).toBe(true);
      const cells = listData.cells as Array<{ source: string }>;
      expect(cells.length).toBe(1);
      // 両方の内容が連結されている
      expect(cells[0].source).toContain('line_a = 1');
      expect(cells[0].source).toContain('line_b = 2');
    }, 30000);

    test('B-2: セル分割', async () => {
      const { notebookPath } = await createTestNotebook('split-b2');

      // 2行のコードを持つセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'top_part = 1\nbottom_part = 2',
      });

      // 行1で分割（split_line=1 → 0行目までが前半、1行目以降が後半）
      const splitResult = await handleToolCall('notebook_split_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        split_line: 1,
      });
      const splitData = parseToolCallResult(splitResult);
      expect(splitData.success).toBe(true);

      // 分割後のセル一覧を確認（2つに増える）
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      expect(listData.success).toBe(true);
      const cells = listData.cells as Array<{ source: string }>;
      expect(cells.length).toBe(2);
      expect(cells[0].source).toContain('top_part = 1');
      expect(cells[1].source).toContain('bottom_part = 2');
    }, 30000);

    test('B-3: 結合→分割の往復', async () => {
      const { notebookPath } = await createTestNotebook('roundtrip-b3');

      // 2つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'first = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'second = 2',
      });

      // 結合
      const mergeResult = await handleToolCall('notebook_merge_cells', {
        notebook_path: notebookPath,
        start_index: 0,
        end_index: 1,
      });
      expect(parseToolCallResult(mergeResult).success).toBe(true);

      // 結合後は1セル
      const afterMerge = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const afterMergeData = parseToolCallResult(afterMerge);
      const mergedCells = afterMergeData.cells as Array<{ source: string }>;
      expect(mergedCells.length).toBe(1);

      // 分割して元に戻す（結合時に改行で連結されるので行1で分割）
      const splitResult = await handleToolCall('notebook_split_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        split_line: 1,
      });
      expect(parseToolCallResult(splitResult).success).toBe(true);

      // 分割後は2セルに戻る
      const afterSplit = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const afterSplitData = parseToolCallResult(afterSplit);
      const splitCells = afterSplitData.cells as Array<{ source: string }>;
      expect(splitCells.length).toBe(2);
      expect(splitCells[0].source).toContain('first = 1');
      expect(splitCells[1].source).toContain('second = 2');
    }, 30000);
  });

  // ======================================================
  // C. notebook_change_cell_type / notebook_copy_cell 結合テスト
  // ======================================================

  describe('C. notebook_change_cell_type / notebook_copy_cell 結合テスト', () => {
    test('C-1: セルタイプ変更 (code → markdown)', async () => {
      const { notebookPath } = await createTestNotebook('type-c1');

      // code セルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: '# This should become markdown',
      });

      // code → markdown に変更
      const changeResult = await handleToolCall('notebook_change_cell_type', {
        notebook_path: notebookPath,
        cell_index: 0,
        new_type: 'markdown',
      });
      const changeData = parseToolCallResult(changeResult);
      expect(changeData.success).toBe(true);

      // セルタイプが markdown に変更されていることを確認
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ cell_type: string; source: string }>;
      expect(cells[0].cell_type).toBe('markdown');
      expect(cells[0].source).toContain('# This should become markdown');
    }, 30000);

    test('C-2: セルタイプ変更 (markdown → code)', async () => {
      const { notebookPath } = await createTestNotebook('type-c2');

      // markdown セルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'markdown',
        source: 'print("hello")',
      });

      // markdown → code に変更
      const changeResult = await handleToolCall('notebook_change_cell_type', {
        notebook_path: notebookPath,
        cell_index: 0,
        new_type: 'code',
      });
      const changeData = parseToolCallResult(changeResult);
      expect(changeData.success).toBe(true);

      // セルタイプが code に変更されていることを確認
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ cell_type: string; source: string }>;
      expect(cells[0].cell_type).toBe('code');
      expect(cells[0].source).toContain('print("hello")');
    }, 30000);

    test('C-3: セルコピー', async () => {
      const { notebookPath } = await createTestNotebook('copy-c3');

      // セルを1つ追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'original_cell = 42',
      });

      // セル0をコピー（target_index 省略 → source_index + 1 に挿入）
      const copyResult = await handleToolCall('notebook_copy_cell', {
        notebook_path: notebookPath,
        source_index: 0,
      });
      const copyData = parseToolCallResult(copyResult);
      expect(copyData.success).toBe(true);

      // コピー後のセル一覧を確認（2つに増える）
      const listResult = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ source: string }>;
      expect(cells.length).toBe(2);
      expect(cells[0].source).toBe('original_cell = 42');
      expect(cells[1].source).toBe('original_cell = 42');
    }, 30000);
  });

  // ======================================================
  // D. notebook_clear_outputs 結合テスト
  // ======================================================

  describe('D. notebook_clear_outputs 結合テスト', () => {
    test('D-1: 単一セルの出力クリア', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('clear-d1');

      // コードセルを追加して実行
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("output_to_clear")',
      });
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
      });
      expect(parseToolCallResult(execResult).success).toBe(true);

      // 単一セルの出力クリア
      const clearResult = await handleToolCall('notebook_clear_outputs', {
        notebook_path: notebookPath,
        cell_index: 0,
      });
      const clearData = parseToolCallResult(clearResult);
      expect(clearData.success).toBe(true);
      expect(clearData.cell_index).toBe(0);
    }, 30000);

    test('D-2: 全セルの出力クリア', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('clear-d2');

      // 2つのコードセルを追加して実行
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("output1")',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print("output2")',
      });
      await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });

      // cell_index 省略で全セルの出力クリア
      const clearResult = await handleToolCall('notebook_clear_outputs', {
        notebook_path: notebookPath,
      });
      const clearData = parseToolCallResult(clearResult);
      expect(clearData.success).toBe(true);
      expect(clearData.cleared_cells).toBeGreaterThanOrEqual(2);
    }, 30000);
  });

  // ======================================================
  // E. kernel_restart 結合テスト
  // ======================================================

  describe('E. kernel_restart 結合テスト', () => {
    test('E-1: カーネル再起動で変数リセット', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('restart-e1');

      // 変数を定義して実行
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'my_var = 12345',
      });
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
      });
      expect(parseToolCallResult(execResult).success).toBe(true);

      // カーネル再起動
      const restartResult = await handleToolCall('kernel_restart', {
        session_id: sessionId,
      });
      const restartData = parseToolCallResult(restartResult);
      expect(restartData.success).toBe(true);

      // 再起動後に変数を参照 → NameError になるはず
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print(my_var)',
      });

      // カーネル再起動後、少し待機してからセル実行
      await new Promise((r) => setTimeout(r, 2000));

      const checkResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 1,
      });
      const checkData = parseToolCallResult(checkResult);
      expect(checkData.success).toBe(true);
      // NameError が発生しているはず
      const error = checkData.error as { type?: string } | undefined;
      expect(error).toBeDefined();
      expect(error?.type).toBe('NameError');
    }, 30000);

    test('E-2: 再起動後の全セル再実行', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('restart-e2');

      // 2つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'restart_var = 999',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print(restart_var)',
      });

      // カーネル再起動
      const restartResult = await handleToolCall('kernel_restart', {
        session_id: sessionId,
      });
      expect(parseToolCallResult(restartResult).success).toBe(true);

      // カーネル再起動後、少し待機
      await new Promise((r) => setTimeout(r, 2000));

      // 再起動後に全セル再実行
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      expect(batchData.executed_cells).toBe(2);
      expect(batchData.success_count).toBe(2);
      expect(batchData.failed_cell).toBeNull();
    }, 30000);
  });

  // ======================================================
  // F. KeyboardInterrupt レスポンス結合テスト
  // ======================================================

  describe('F. KeyboardInterrupt レスポンス結合テスト', () => {
    test('F-1: notebook_execute_cell で KeyboardInterrupt', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('interrupt-f1');

      // 無限ループのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'import time\nwhile True:\n    time.sleep(0.1)',
      });

      // セル実行を開始（Promise を保持して後から結果を取得）
      const execPromise = handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
        timeout: 30,
      });

      // 実行開始を待ってからカーネルを中断
      await new Promise((r) => setTimeout(r, 2000));
      const kernelId = await resolveKernelId(sessionId);
      await jupyterClient.interruptKernel(kernelId);

      // 実行結果を取得
      const execResult = await execPromise;
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(true);
      // KeyboardInterrupt エラーが含まれるはず
      const error = execData.error as { type?: string } | undefined;
      expect(error).toBeDefined();
      expect(error?.type).toBe('KeyboardInterrupt');
    }, 30000);

    test('F-2: notebook_execute_batch で KeyboardInterrupt', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('interrupt-f2');

      // 通常セル + 無限ループセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'import time\nwhile True:\n    time.sleep(0.1)',
      });

      // batch 実行を開始
      const batchPromise = handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
        timeout: 30,
      });

      // 実行開始を待ってからカーネルを中断
      await new Promise((r) => setTimeout(r, 3000));
      const kernelId = await resolveKernelId(sessionId);
      await jupyterClient.interruptKernel(kernelId);

      // 実行結果を取得
      const batchResult = await batchPromise;
      const batchData = parseToolCallResult(batchResult);
      expect(batchData.success).toBe(true);
      // failed_cell が存在し、KeyboardInterrupt 情報が含まれる
      expect(batchData.failed_cell).toBeDefined();
      const batchError = batchData.error as { type?: string } | undefined;
      expect(batchError).toBeDefined();
      expect(batchError?.type).toBe('KeyboardInterrupt');
    }, 30000);
  });

  // ======================================================
  // G. E2E フロー
  // ======================================================

  describe('G. E2E フロー', () => {
    test('G-1: Phase 19 ツール組み合わせフロー', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('e2e-g1');

      // 1. セル追加（3つ）
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'step1 = "import"',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'step2 = "process"',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print(f"{step1} -> {step2}")',
      });

      // 2. 一括実行
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      expect(parseToolCallResult(batchResult).success).toBe(true);
      expect(parseToolCallResult(batchResult).success_count).toBe(3);

      // 3. セル結合（セル0とセル1を結合）
      const mergeResult = await handleToolCall('notebook_merge_cells', {
        notebook_path: notebookPath,
        start_index: 0,
        end_index: 1,
      });
      expect(parseToolCallResult(mergeResult).success).toBe(true);

      // 4. セル分割（結合されたセルを行1で分割して元に戻す）
      const splitResult = await handleToolCall('notebook_split_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        split_line: 1,
      });
      expect(parseToolCallResult(splitResult).success).toBe(true);

      // 5. セルタイプ変更（セル0を markdown に）
      const changeResult = await handleToolCall('notebook_change_cell_type', {
        notebook_path: notebookPath,
        cell_index: 0,
        new_type: 'markdown',
      });
      expect(parseToolCallResult(changeResult).success).toBe(true);

      // 6. セルコピー（セル1をコピー）
      const copyResult = await handleToolCall('notebook_copy_cell', {
        notebook_path: notebookPath,
        source_index: 1,
      });
      expect(parseToolCallResult(copyResult).success).toBe(true);

      // 7. 出力クリア（全セル）
      const clearResult = await handleToolCall('notebook_clear_outputs', {
        notebook_path: notebookPath,
      });
      expect(parseToolCallResult(clearResult).success).toBe(true);

      // 8. カーネル再起動
      const restartResult = await handleToolCall('kernel_restart', {
        session_id: sessionId,
      });
      expect(parseToolCallResult(restartResult).success).toBe(true);

      // カーネル再起動後、少し待機
      await new Promise((r) => setTimeout(r, 2000));

      // 9. 再実行（全セル）
      const reBatchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      const reBatchData = parseToolCallResult(reBatchResult);
      expect(reBatchData.success).toBe(true);
      // markdown セルはスキップされるので、コードセルのみ実行される
      expect(reBatchData.executed_cells).toBeGreaterThanOrEqual(1);
    }, 60000);

    test('G-2: 既存ツール + Phase 19 ツール混在フロー', async () => {
      const { sessionId, notebookPath } = await createTestNotebook('e2e-g2');

      // 1. セル追加（Phase 16）
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'data = [1, 2, 3]',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'total = sum(data)',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'print(f"Total: {total}")',
      });

      // 2. セル編集（Phase 16）
      const editResult = await handleToolCall('notebook_edit_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        source: 'data = [10, 20, 30]',
      });
      expect(parseToolCallResult(editResult).success).toBe(true);

      // 3. 一括実行（Phase 19）
      const batchResult = await handleToolCall('notebook_execute_batch', {
        notebook_path: notebookPath,
        session_id: sessionId,
        mode: 'all',
      });
      expect(parseToolCallResult(batchResult).success).toBe(true);
      expect(parseToolCallResult(batchResult).success_count).toBe(3);

      // 4. セル結合（Phase 19: セル0とセル1を結合）
      const mergeResult = await handleToolCall('notebook_merge_cells', {
        notebook_path: notebookPath,
        start_index: 0,
        end_index: 1,
      });
      expect(parseToolCallResult(mergeResult).success).toBe(true);

      // 5. セル削除（Phase 16: 結合後の最後のセルを削除）
      // 結合後のセル数を確認
      const listAfterMerge = await handleToolCall('notebook_list_cells', {
        notebook_path: notebookPath,
      });
      const mergedCells = parseToolCallResult(listAfterMerge).cells as Array<{ source: string }>;
      const lastIndex = mergedCells.length - 1;

      const deleteResult = await handleToolCall('notebook_delete_cell', {
        notebook_path: notebookPath,
        cell_index: lastIndex,
      });
      expect(parseToolCallResult(deleteResult).success).toBe(true);

      // 6. セル再実行（Phase 16: 残ったセルを実行）
      const execResult = await handleToolCall('notebook_execute_cell', {
        notebook_path: notebookPath,
        session_id: sessionId,
        cell_index: 0,
      });
      expect(parseToolCallResult(execResult).success).toBe(true);

      // 7. 出力クリア（Phase 19）
      const clearResult = await handleToolCall('notebook_clear_outputs', {
        notebook_path: notebookPath,
      });
      expect(parseToolCallResult(clearResult).success).toBe(true);
    }, 60000);
  });
});
