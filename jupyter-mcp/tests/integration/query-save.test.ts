/**
 * クエリ保存の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - PostgreSQL が起動していること
 * - DATA_ENV=sample でサンプルデータが読み込まれていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { cleanupSession, cleanupWorkspace, checkJupyterConnection, parseToolCallResult } from '../setup.js';
import { resolveWorkspacePath } from '../../src/utils/workspace-path-store.js';

interface FileEntry {
  name: string;
  type: string;
  size?: number;
}

describe('クエリ保存の結合テスト', () => {
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
  });

  async function createTestEnvironment(testName: string): Promise<{ workspaceId: string; sessionId: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-querysave-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    // execute_sql には notebook_path 付きセッションが必要
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

  test('execute_sql 成功時にレスポンスに query_file_path が含まれる', async () => {
    const { sessionId } = await createTestEnvironment('response-check');

    const result = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT 1 AS test_col',
      filename: 'test_response.csv',
    });
    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.query_file_path).toBeDefined();
    expect(data.query_file_path).toMatch(/^data\/queries\/001_.*\.sql$/);
  });

  test('file_list で data/queries/ 配下にクエリファイルが確認できる', async () => {
    const { workspaceId, sessionId } = await createTestEnvironment('filelist-check');

    // execute_sql でクエリを実行
    const sqlResult = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT 1 AS col',
      filename: 'filelist_test.csv',
    });
    expect(parseToolCallResult(sqlResult).success).toBe(true);

    // file_list で data/queries/ を確認
    const fileListResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
      path: 'data/queries',
    });
    const fileListData = parseToolCallResult(fileListResult);
    expect(fileListData.success).toBe(true);

    const contents = fileListData.contents as FileEntry[];
    const sqlFiles = contents.filter((f) => f.name.endsWith('.sql'));
    expect(sqlFiles.length).toBeGreaterThanOrEqual(1);
  });

  test('クエリファイルにメタデータとSQL本文が含まれる', async () => {
    const { sessionId } = await createTestEnvironment('metadata-check');

    const testSql = "SELECT 1 AS id, 'test_name' AS name, NOW() AS created_at";
    const result = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: testSql,
      filename: 'metadata_test.csv',
    });
    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);

    const queryFilePath = data.query_file_path as string;

    // execute_code で .sql ファイルの内容を読み込み
    const readResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: `
with open('${queryFilePath}', 'r') as f:
    content = f.read()
print(content)
`,
    });
    const readData = parseToolCallResult(readResult);
    expect(readData.success).toBe(true);

    const fileContent = readData.stdout as string;

    // メタデータ行の検証
    expect(fileContent).toContain('-- executed_at:');
    expect(fileContent).toContain('-- result_file: metadata_test.csv');
    expect(fileContent).toContain('-- row_count:');
    expect(fileContent).toContain('-- execution_time_ms:');

    // SQL本文の検証
    expect(fileContent).toContain(testSql);
  });

  test('複数回実行で連番がインクリメントされる', async () => {
    const { sessionId } = await createTestEnvironment('sequence-check');

    // 1回目
    const result1 = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT 1',
      filename: 'seq_first.csv',
    });
    const data1 = parseToolCallResult(result1);
    expect(data1.success).toBe(true);
    expect(data1.query_file_path).toMatch(/^data\/queries\/001_/);

    // 2回目
    const result2 = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT 2',
      filename: 'seq_second.csv',
    });
    const data2 = parseToolCallResult(result2);
    expect(data2.success).toBe(true);
    expect(data2.query_file_path).toMatch(/^data\/queries\/002_/);
  });

  test('export_sql 成功時にレスポンスに query_file_path が含まれる', async () => {
    const { sessionId } = await createTestEnvironment('export-response');

    const result = await handleToolCall('export_sql', {
      session_id: sessionId,
      sql: 'SELECT 1 AS test_col',
      filename: 'export_query_test.parquet',
    });
    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.query_file_path).toBeDefined();
    expect(data.query_file_path).toMatch(/^data\/queries\/001_.*\.sql$/);
  });

  test('export_sql でクエリファイルにメタデータとSQL本文が含まれる', async () => {
    const { sessionId } = await createTestEnvironment('export-metadata');

    const testSql = "SELECT 42 AS value, 'export_test' AS label";
    const result = await handleToolCall('export_sql', {
      session_id: sessionId,
      sql: testSql,
      filename: 'export_meta_test.parquet',
    });
    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);

    const queryFilePath = data.query_file_path as string;

    // execute_code で .sql ファイルの内容を読み込み
    const readResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: `
with open('${queryFilePath}', 'r') as f:
    content = f.read()
print(content)
`,
    });
    const readData = parseToolCallResult(readResult);
    expect(readData.success).toBe(true);

    const fileContent = readData.stdout as string;

    // メタデータ行の検証
    expect(fileContent).toContain('-- executed_at:');
    expect(fileContent).toContain('-- result_file: export_meta_test.parquet');
    expect(fileContent).toContain('-- row_count:');
    expect(fileContent).toContain('-- execution_time_ms:');

    // SQL本文の検証
    expect(fileContent).toContain(testSql);
  });

  test('export_sql と execute_sql の連番が共有される', async () => {
    const { sessionId } = await createTestEnvironment('shared-sequence');

    // execute_sql で1回目
    const result1 = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT 1',
      filename: 'shared_exec.csv',
    });
    const data1 = parseToolCallResult(result1);
    expect(data1.success).toBe(true);
    expect(data1.query_file_path).toMatch(/^data\/queries\/001_/);

    // export_sql で2回目
    const result2 = await handleToolCall('export_sql', {
      session_id: sessionId,
      sql: 'SELECT 2',
      filename: 'shared_export.parquet',
    });
    const data2 = parseToolCallResult(result2);
    expect(data2.success).toBe(true);
    expect(data2.query_file_path).toMatch(/^data\/queries\/002_/);
  });

  test('エラー時にはクエリファイルが保存されない', async () => {
    const { workspaceId, sessionId } = await createTestEnvironment('error-check');

    // 不正SQLを実行（エラーになる）
    const errorResult = await handleToolCall('execute_sql', {
      session_id: sessionId,
      sql: 'SELECT * FROM nonexistent_table_xyz_12345',
      filename: 'error_test.csv',
    });
    const errorData = parseToolCallResult(errorResult);
    expect(errorData.success).toBe(false);

    // data/queries/ にファイルが保存されていないことを確認
    const fileListResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
      path: 'data/queries',
    });
    const fileListData = parseToolCallResult(fileListResult);

    // ディレクトリが存在しないか、空であること
    if (fileListData.success) {
      const contents = fileListData.contents as FileEntry[];
      const sqlFiles = contents.filter((f) => f.name.endsWith('.sql'));
      expect(sqlFiles.length).toBe(0);
    }
    // success=false（ディレクトリ自体が存在しない）でもOK
  });
});
