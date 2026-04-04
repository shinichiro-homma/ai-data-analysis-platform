/**
 * Phase 17 追加ツールの結合テスト
 *
 * 対象ツール:
 * - notebook_reorder_cell
 * - data_preview
 * - file_read
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - PostgreSQL が起動していること
 * - DATA_ENV=sample でサンプルデータが読み込まれていること
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
import { resolveWorkspacePath } from '../../src/utils/workspace-path-store.js';

describe('Phase 17 ツール結合テスト', () => {
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
      name: `test-p17-${testName}-${Date.now()}`,
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

  /**
   * export_sql 用: notebook_path 付きセッションを作成するヘルパー
   */
  async function createTestEnvironmentForExportSql(
    testName: string,
  ): Promise<{ workspaceId: string; sessionId: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-p17-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const notebookName = `analysis-${testName}.ipynb`;
    const wsPath = await resolveWorkspacePath(workspaceId);
    await jupyterClient.createNotebook(`${wsPath}/${notebookName}`);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookName,
    });
    const sessData = parseToolCallResult(sessResult);
    expect(sessData.success).toBe(true);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    return { workspaceId, sessionId };
  }

  // ======================================================
  // A. notebook_reorder_cell 結合テスト
  // ======================================================

  describe('A. notebook_reorder_cell 結合テスト', () => {
    test('A-1: 先頭セル（index=0）を末尾（to_index=2）に移動 → list_cells で順序確認', async () => {
      const { notebookPath } = await createTestNotebook('reorder-a1');

      // 3つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_A = 1',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_B = 2',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_C = 3',
      });

      // 先頭セルを末尾に移動
      const reorderResult = await handleToolCall('notebook_reorder_cell', {
        notebook_path: notebookPath,
        cell_index: 0,
        to_index: 2,
      });
      const reorderData = parseToolCallResult(reorderResult);
      expect(reorderData.success).toBe(true);

      // 順序確認: B, C, A の順になるはず
      const listResult = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const listData = parseToolCallResult(listResult);
      expect(listData.success).toBe(true);
      const cells = listData.cells as Array<{ cell_index: number; source: string }>;
      expect(cells[0].source).toBe('cell_B = 2');
      expect(cells[1].source).toBe('cell_C = 3');
      expect(cells[2].source).toBe('cell_A = 1');
    });

    test('A-2: 末尾セル（index=2）を先頭（to_index=0）に移動 → list_cells で順序確認', async () => {
      const { notebookPath } = await createTestNotebook('reorder-a2');

      // 3つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_X = 10',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_Y = 20',
      });
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'cell_Z = 30',
      });

      // 末尾セルを先頭に移動
      const reorderResult = await handleToolCall('notebook_reorder_cell', {
        notebook_path: notebookPath,
        cell_index: 2,
        to_index: 0,
      });
      const reorderData = parseToolCallResult(reorderResult);
      expect(reorderData.success).toBe(true);

      // 順序確認: Z, X, Y の順になるはず
      const listResult = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ cell_index: number; source: string }>;
      expect(cells[0].source).toBe('cell_Z = 30');
      expect(cells[1].source).toBe('cell_X = 10');
      expect(cells[2].source).toBe('cell_Y = 20');
    });

    test('A-3: 範囲外 cell_index で reorder → エラー', async () => {
      const { notebookPath } = await createTestNotebook('reorder-a3');

      // 1つのセルを追加
      await handleToolCall('notebook_add_cell', {
        notebook_path: notebookPath,
        cell_type: 'code',
        source: 'x = 1',
      });

      // 範囲外インデックスで並び替え
      const reorderResult = await handleToolCall('notebook_reorder_cell', {
        notebook_path: notebookPath,
        cell_index: 999,
        to_index: 0,
      });
      const reorderData = parseToolCallResult(reorderResult);
      expect(reorderData.success).toBe(false);
    });
  });

  // ======================================================
  // B. data_preview 結合テスト
  // ======================================================

  describe('B. data_preview 結合テスト', () => {
    test('B-1: execute_code で CSV を data/ に作成 → data_preview でカラム名・型・先頭行を確認', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-dp-b1-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      expect(wsData.success).toBe(true);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const sessResult = await handleToolCall('session_create', { workspace_id: wId });
      const sessData = parseToolCallResult(sessResult);
      expect(sessData.success).toBe(true);
      const sId = sessData.session_id as string;
      createdSessionIds.push(sId);

      // CSVファイルを data/ に作成
      const createCsvResult = await handleToolCall('execute_code', {
        session_id: sId,
        code: `
import pandas as pd
df = pd.DataFrame({'id': [1, 2, 3], 'name': ['Alice', 'Bob', 'Charlie'], 'score': [85.5, 92.0, 78.3]})
df.to_csv('data/test_preview.csv', index=False)
print('done')
`,
      });
      const createCsvData = parseToolCallResult(createCsvResult);
      expect(createCsvData.success).toBe(true);
      expect(createCsvData.stdout).toContain('done');

      // data_preview でプレビュー
      const previewResult = await handleToolCall('data_preview', {
        workspace_id: wId,
        file_path: 'data/test_preview.csv',
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(true);
      expect(previewData.columns).toBeDefined();
      const columns = previewData.columns as Array<{ name: string; dtype: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('score');
      expect(previewData.head).toBeDefined();
    }, 20000);

    test('B-2: export_sql で Parquet を data/ に保存 → data_preview で構造確認', async () => {
      const { workspaceId, sessionId } = await createTestEnvironmentForExportSql('dp-b2');

      // export_sql で customer_master を Parquet にエクスポート
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: 'SELECT customer_id, customer_name FROM customer_master LIMIT 5',
        filename: 'preview_test.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);
      expect(exportData.format).toBe('parquet');

      // data_preview でプレビュー
      const previewResult = await handleToolCall('data_preview', {
        workspace_id: workspaceId,
        file_path: 'data/preview_test.parquet',
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(true);
      const columns = previewData.columns as Array<{ name: string; dtype: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain('customer_id');
      expect(columnNames).toContain('customer_name');
      expect(previewData.head).toBeDefined();
    }, 20000);

    test('B-3: head_rows=2 指定で先頭行数が制限されることを確認', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-dp-b3-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      expect(wsData.success).toBe(true);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const sessResult = await handleToolCall('session_create', { workspace_id: wId });
      const sessData = parseToolCallResult(sessResult);
      expect(sessData.success).toBe(true);
      const sId = sessData.session_id as string;
      createdSessionIds.push(sId);

      // 10行のCSVを作成
      const createResult = await handleToolCall('execute_code', {
        session_id: sId,
        code: `
import pandas as pd
df = pd.DataFrame({'val': list(range(10))})
df.to_csv('data/headrows_test.csv', index=False)
print('done')
`,
      });
      expect(parseToolCallResult(createResult).success).toBe(true);

      // head_rows=2 で data_preview
      const previewResult = await handleToolCall('data_preview', {
        workspace_id: wId,
        file_path: 'data/headrows_test.csv',
        head_rows: 2,
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(true);
      const head = previewData.head as unknown[];
      // head_rows=2 なので先頭2行のみ返る
      expect(head.length).toBeLessThanOrEqual(2);
    }, 20000);

    test('B-4: 存在しないファイルパス → エラー', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-dp-b4-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const previewResult = await handleToolCall('data_preview', {
        workspace_id: wId,
        file_path: 'data/nonexistent_file_xyz.csv',
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(false);
    });

    test('B-5: パストラバーサル（../etc/passwd）→ VALIDATION_ERROR', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-dp-b5-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const previewResult = await handleToolCall('data_preview', {
        workspace_id: wId,
        file_path: '../etc/passwd',
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(false);
      const error = previewData.error as { code?: string; message?: string } | undefined;
      expect(error?.code).toBe('VALIDATION_ERROR');
    });
  });

  // ======================================================
  // C. file_read 結合テスト
  // ======================================================

  describe('C. file_read 結合テスト', () => {
    test('C-1: execute_code で .py ファイルをワークスペースに作成 → file_read で内容取得', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-fr-c1-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      expect(wsData.success).toBe(true);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const sessResult = await handleToolCall('session_create', { workspace_id: wId });
      const sessData = parseToolCallResult(sessResult);
      expect(sessData.success).toBe(true);
      const sId = sessData.session_id as string;
      createdSessionIds.push(sId);

      // .py ファイルを作成
      const pyCode = `# test python file\ndef greet(name):\n    return f"Hello, {name}!"\n`;
      const createResult = await handleToolCall('execute_code', {
        session_id: sId,
        code: `
with open('utils.py', 'w') as f:
    f.write('''# test python file\\ndef greet(name):\\n    return f"Hello, {name}!"\\n''')
print('created')
`,
      });
      const createData = parseToolCallResult(createResult);
      expect(createData.success).toBe(true);
      expect(createData.stdout).toContain('created');

      // file_read で内容取得
      const readResult = await handleToolCall('file_read', {
        workspace_id: wId,
        file_path: 'utils.py',
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);
      expect(readData.content).toBeDefined();
      const content = readData.content as string;
      expect(content).toContain('def greet');
    }, 20000);

    test('C-2: export_sql 後に data/queries/ の .sql ファイルを file_read で読み取り', async () => {
      const { workspaceId, sessionId } = await createTestEnvironmentForExportSql('fr-c2');

      // export_sql でクエリを実行（クエリファイルが data/queries/ に保存される）
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: 'SELECT customer_id FROM customer_master LIMIT 3',
        filename: 'query_test.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);
      expect(exportData.query_file_path).toBeDefined();
      const queryFilePath = exportData.query_file_path as string;
      // "data/queries/001_xxx.sql" 形式
      expect(queryFilePath).toMatch(/^data\/queries\/\d{3}_.*\.sql$/);

      // file_read でSQLファイル内容取得
      const readResult = await handleToolCall('file_read', {
        workspace_id: workspaceId,
        file_path: queryFilePath,
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);
      const content = readData.content as string;
      expect(content).toContain('customer_id');
      expect(content).toContain('customer_master');
    }, 20000);

    test('C-3: .ipynb ファイル指定 → VALIDATION_ERROR', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-fr-c3-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const readResult = await handleToolCall('file_read', {
        workspace_id: wId,
        file_path: 'some_notebook.ipynb',
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(false);
      const error = readData.error as { code?: string; message?: string } | undefined;
      expect(error?.code).toBe('VALIDATION_ERROR');
    });

    test('C-4: 存在しないファイル → エラー', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-fr-c4-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const readResult = await handleToolCall('file_read', {
        workspace_id: wId,
        file_path: 'nonexistent_file_abc.txt',
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(false);
    });

    test('C-5: パストラバーサル（../etc/passwd）→ VALIDATION_ERROR', async () => {
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-fr-c5-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      const wId = wsData.workspace_id as string;
      createdWorkspaceIds.push(wId);

      const readResult = await handleToolCall('file_read', {
        workspace_id: wId,
        file_path: '../etc/passwd',
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(false);
      const error = readData.error as { code?: string; message?: string } | undefined;
      expect(error?.code).toBe('VALIDATION_ERROR');
    });
  });

  // ======================================================
  // D. ツール連携 E2E フロー
  // ======================================================

  describe('D. ツール連携 E2E フロー', () => {
    test('D-1: ノートブック作成 → セル3つ追加 → reorder → execute_code でCSV作成 → data_preview → file_read', async () => {
      // 1. ワークスペース + セッション作成
      const wsResult = await handleToolCall('workspace_create', {
        name: `test-p17-e2e-d1-${Date.now()}`,
      });
      const wsData = parseToolCallResult(wsResult);
      expect(wsData.success).toBe(true);
      const workspaceId = wsData.workspace_id as string;
      createdWorkspaceIds.push(workspaceId);

      const sessResult = await handleToolCall('session_create', { workspace_id: workspaceId });
      const sessData = parseToolCallResult(sessResult);
      expect(sessData.success).toBe(true);
      const sessionId = sessData.session_id as string;
      createdSessionIds.push(sessionId);

      // 2. ノートブック作成
      const notebookName = generateTestNotebookName('e2e-d1');
      const nbResult = await handleToolCall('notebook_create', {
        workspace_id: workspaceId,
        session_id: sessionId,
        name: notebookName,
      });
      const nbData = parseToolCallResult(nbResult);
      expect(nbData.success).toBe(true);
      const notebookPath = nbData.path as string;

      // 3. セル3つ追加
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
        source: `
import pandas as pd
df = pd.DataFrame({'product': ['A', 'B', 'C'], 'price': [100, 200, 300]})
df.to_csv('data/e2e_products.csv', index=False)
print('csv_created')
`,
      });

      // 4. reorder: 末尾セル（CSV作成コード）を先頭に移動
      const reorderResult = await handleToolCall('notebook_reorder_cell', {
        notebook_path: notebookPath,
        cell_index: 2,
        to_index: 0,
      });
      expect(parseToolCallResult(reorderResult).success).toBe(true);

      // 5. リオーダー後の順序確認
      const listResult = await handleToolCall('notebook_list_cells', { notebook_path: notebookPath });
      const listData = parseToolCallResult(listResult);
      const cells = listData.cells as Array<{ cell_index: number; source: string }>;
      // 先頭がCSV作成コードになっているはず
      expect(cells[0].source).toContain('e2e_products.csv');

      // 6. execute_code でCSVを作成
      const execResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
df = pd.DataFrame({'product': ['A', 'B', 'C'], 'price': [100, 200, 300]})
df.to_csv('data/e2e_products.csv', index=False)
print('csv_created')
`,
      });
      const execData = parseToolCallResult(execResult);
      expect(execData.success).toBe(true);
      expect(execData.stdout).toContain('csv_created');

      // 7. data_preview でCSVをプレビュー
      const previewResult = await handleToolCall('data_preview', {
        workspace_id: workspaceId,
        file_path: 'data/e2e_products.csv',
      });
      const previewData = parseToolCallResult(previewResult);
      expect(previewData.success).toBe(true);
      const columns = previewData.columns as Array<{ name: string }>;
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).toContain('product');
      expect(columnNames).toContain('price');

      // 8. file_read で既存ファイル読み取り (e2e_products.csv)
      const readResult = await handleToolCall('file_read', {
        workspace_id: workspaceId,
        file_path: 'data/e2e_products.csv',
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);
      const content = readData.content as string;
      expect(content).toContain('product');
      expect(content).toContain('price');
    }, 30000);
  });
});
