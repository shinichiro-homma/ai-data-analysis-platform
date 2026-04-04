import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeExecuteSql } from '../../../src/tools/execute-sql.js';
import type { SqlExecuteResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    executeSql: vi.fn(),
    ensureDirectory: vi.fn(),
    listContents: vi.fn(),
    writeTextFile: vi.fn(),
    listWorkspaces: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveWorkspaceIdOrError: vi.fn(),
}));

// workspace-path-store をモック
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  extractWorkspaceIdFromPath: vi.fn((path: string) => {
    const match = path.match(/workspaces\/([^/]+)\//);
    return Promise.resolve(match ? match[1] : null);
  }),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveWorkspaceIdOrError } from '../../../src/utils/session-resolver.js';

describe('executeExecuteSql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルト: ワークスペースID解決成功
    vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({ workspaceId: 'ws-abc123' });
    // デフォルト: クエリ保存関連のモック
    vi.mocked(jupyterClient.ensureDirectory).mockResolvedValue(undefined);
    vi.mocked(jupyterClient.listContents).mockResolvedValue({
      path: '/workspaces/ws-abc123/data/queries',
      contents: [],
    });
    vi.mocked(jupyterClient.writeTextFile).mockResolvedValue(undefined);
  });

  describe('正常系', () => {
    test('SQLクエリ実行成功 => メタデータ返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/transactions.csv',
        row_count: 1000,
        columns: ['customer_id', 'transaction_date', 'amount'],
        file_size_bytes: 32768,
        execution_time_ms: 250,
        truncated: false,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT customer_id, transaction_date, amount FROM transactions',
        filename: 'transactions.csv',
      });

      expect(resolveWorkspaceIdOrError).toHaveBeenCalledWith('session-123');
      expect(jupyterClient.executeSql).toHaveBeenCalledWith({
        sql: 'SELECT customer_id, transaction_date, amount FROM transactions',
        workspace_id: 'ws-abc123',
        filename: 'transactions.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.file_path).toBe('workspaces/ws-abc123/data/transactions.csv');
      expect(parsed.row_count).toBe(1000);
      expect(parsed.columns).toEqual(['customer_id', 'transaction_date', 'amount']);
      expect(parsed.file_size_bytes).toBe(32768);
      expect(parsed.execution_time_ms).toBe(250);
      expect(parsed.truncated).toBe(false);
      expect(parsed.query_file_path).toBe('data/queries/001_transactions.sql');
    });

    test('非SELECT（INSERT INTO）実行成功 => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        execution_time_ms: 50,
        affected_rows: 3,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')",
        filename: 'insert_users.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(3);
      expect(parsed.execution_time_ms).toBe(50);
      expect(parsed.file_path).toBeUndefined();
      expect(parsed.row_count).toBeUndefined();
      expect(parsed.columns).toBeUndefined();
      expect(parsed.query_file_path).toBe('data/queries/001_insert_users.sql');
    });

    test('DDL: CREATE TEMP TABLE => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 50,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'CREATE TEMP TABLE tmp AS SELECT 1',
        filename: 'create_temp.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('DDL: DROP TABLE => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 30,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'DROP TABLE IF EXISTS tmp',
        filename: 'drop_table.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('DDL: TRUNCATE TABLE => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 20,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'TRUNCATE TABLE tmp',
        filename: 'truncate.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('DML: UPDATE => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 50,
        execution_time_ms: 80,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: "UPDATE users SET name = 'Bob' WHERE id = 1",
        filename: 'update_users.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(50);
      expect(parsed.file_path).toBeUndefined();
    });

    test('Transaction: BEGIN => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 5,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'BEGIN',
        filename: 'begin.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('Transaction: COMMIT => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 5,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'COMMIT',
        filename: 'commit.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('Transaction: ROLLBACK => affected_rows 返却', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        affected_rows: 0,
        execution_time_ms: 5,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'ROLLBACK',
        filename: 'rollback.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.affected_rows).toBe(0);
      expect(parsed.file_path).toBeUndefined();
    });

    test('timeout / max_rows オプション指定が正しく渡される', async () => {
      const mockResult: SqlExecuteResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/result.csv',
        row_count: 500,
        columns: ['id', 'name'],
        file_size_bytes: 8192,
        execution_time_ms: 100,
        truncated: true,
      };

      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT id, name FROM users',
        filename: 'result.csv',
        timeout: 60,
        max_rows: 500,
      });

      expect(jupyterClient.executeSql).toHaveBeenCalledWith({
        sql: 'SELECT id, name FROM users',
        workspace_id: 'ws-abc123',
        filename: 'result.csv',
        timeout: 60,
        max_rows: 500,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.truncated).toBe(true);
    });
  });

  describe('バリデーションエラー', () => {
    test('session_id 未指定 => VALIDATION_ERROR with isError flag', async () => {
      const result = await executeExecuteSql({
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('session_id');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });

    test('sql 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeExecuteSql({
        session_id: 'session-123',
        filename: 'users.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('sql');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });

    test('filename 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('filename');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });

    test('session_id 空文字 => VALIDATION_ERROR', async () => {
      const result = await executeExecuteSql({
        session_id: '',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });
  });

  describe('APIエラー', () => {
    test('SQL_NOT_ALLOWED（DELETEクエリ） => エラー返却', async () => {
      const error = new Error('DELETE statements are not allowed.');
      (error as any).code = 'SQL_NOT_ALLOWED';

      vi.mocked(jupyterClient.executeSql).mockRejectedValue(error);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'DELETE FROM users WHERE id = 1',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_NOT_ALLOWED');
      expect(parsed.error.message).toContain('DELETE');
    });

    test('SQL_EXECUTION_ERROR => エラー返却', async () => {
      const error = new Error('SQL execution failed. Check your query syntax.');
      (error as any).code = 'SQL_EXECUTION_ERROR';

      vi.mocked(jupyterClient.executeSql).mockRejectedValue(error);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM nonexistent_table',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_EXECUTION_ERROR');
    });

    test('DATABASE_CONNECTION_ERROR => エラー返却 with isError flag', async () => {
      const error = new Error('Could not connect to database.');
      (error as any).code = 'DATABASE_CONNECTION_ERROR';

      vi.mocked(jupyterClient.executeSql).mockRejectedValue(error);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'result.csv',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('DATABASE_CONNECTION_ERROR');
    });

    test('SQL_TIMEOUT => エラー返却', async () => {
      const error = new Error('Query execution timed out after 30 seconds');
      (error as any).code = 'SQL_TIMEOUT';

      vi.mocked(jupyterClient.executeSql).mockRejectedValue(error);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM large_table',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_TIMEOUT');
    });

    test('resolveWorkspaceIdOrError がフォールバック経由で workspace_id を返す場合も正常動作する', async () => {
      // resolveWorkspaceIdOrError は内部で notebookPath → sessionWorkspaceStore のフォールバックを行う
      vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({ workspaceId: 'ws-abc123' });

      const mockResult: SqlExecuteResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/result.csv',
        row_count: 100,
        columns: ['id', 'name'],
        file_size_bytes: 2048,
        execution_time_ms: 100,
        truncated: false,
      };
      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockResult);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(jupyterClient.executeSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users',
        workspace_id: 'ws-abc123',
        filename: 'result.csv',
      });
    });

    test('WORKSPACE_NOT_FOUND（resolveWorkspaceIdOrError がエラーを返す）=> エラー返却', async () => {
      vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({
        error: {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'WORKSPACE_NOT_FOUND', message: 'セッションからワークスペースIDを特定できません。' } }) }],
          isError: true,
        },
      });

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('WORKSPACE_NOT_FOUND');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });

    test('セッション解決失敗 => エラー返却', async () => {
      vi.mocked(resolveWorkspaceIdOrError).mockRejectedValue(new Error('Session not found'));

      const result = await executeExecuteSql({
        session_id: 'nonexistent',
        sql: 'SELECT * FROM users',
        filename: 'result.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Session not found');
      expect(jupyterClient.executeSql).not.toHaveBeenCalled();
    });
  });

  describe('クエリ保存', () => {
    const mockSqlResult: SqlExecuteResponse = {
      success: true,
      file_path: 'workspaces/ws-abc123/data/transactions.csv',
      row_count: 1500,
      columns: ['id', 'amount'],
      file_size_bytes: 16384,
      execution_time_ms: 250,
      truncated: false,
    };

    beforeEach(() => {
      vi.mocked(jupyterClient.executeSql).mockResolvedValue(mockSqlResult);
    });

    test('SQL実行成功時にクエリファイルが保存される', async () => {
      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT id, amount FROM transactions',
        filename: 'transactions.csv',
      });

      // ディレクトリ確保
      expect(jupyterClient.ensureDirectory).toHaveBeenCalledWith('workspaces/ws-abc123/data/queries');

      // ファイル書き込み
      expect(jupyterClient.writeTextFile).toHaveBeenCalledWith(
        'workspaces/ws-abc123/data/queries/001_transactions.sql',
        expect.stringContaining('SELECT id, amount FROM transactions'),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.query_file_path).toBe('data/queries/001_transactions.sql');
    });

    test('レスポンスに query_file_path が含まれる', async () => {
      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.query_file_path).toBe('data/queries/001_users.sql');
    });

    test('連番が正しくインクリメントされる', async () => {
      // 既存ファイルが2つある場合
      vi.mocked(jupyterClient.listContents).mockResolvedValue({
        path: '/workspaces/ws-abc123/data/queries',
        contents: [
          { name: '001_first.sql', type: 'file', modified_at: '2024-01-01T00:00:00Z' },
          { name: '002_second.sql', type: 'file', modified_at: '2024-01-02T00:00:00Z' },
        ],
      });

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM orders',
        filename: 'orders.csv',
      });

      expect(jupyterClient.writeTextFile).toHaveBeenCalledWith(
        'workspaces/ws-abc123/data/queries/003_orders.sql',
        expect.any(String),
      );

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.query_file_path).toBe('data/queries/003_orders.sql');
    });

    test('filename の拡張子が除去される', async () => {
      await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'transactions.csv',
      });

      expect(jupyterClient.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('001_transactions.sql'),
        expect.any(String),
      );
    });

    test('メタデータが正しいフォーマットで含まれる', async () => {
      await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      const writeCall = vi.mocked(jupyterClient.writeTextFile).mock.calls[0];
      const content = writeCall[1];

      expect(content).toMatch(/^-- executed_at: \d{4}-\d{2}-\d{2}T/);
      expect(content).toContain('-- result_file: users.csv');
      expect(content).toContain('-- row_count: 1500');
      expect(content).toContain('-- execution_time_ms: 250');
      expect(content).toContain('SELECT * FROM users');
    });

    test('data/queries/ ディレクトリが未作成の場合に作成される', async () => {
      // listContents がエラー（ディレクトリ未存在）
      vi.mocked(jupyterClient.listContents).mockRejectedValue(new Error('Not found'));

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      expect(jupyterClient.ensureDirectory).toHaveBeenCalledWith('workspaces/ws-abc123/data/queries');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      // listContents 失敗時は 0 + 1 = 001
      expect(parsed.query_file_path).toBe('data/queries/001_users.sql');
    });

    test('バリデーションエラー時にクエリ保存されない', async () => {
      await executeExecuteSql({
        session_id: '',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      expect(jupyterClient.writeTextFile).not.toHaveBeenCalled();
      expect(jupyterClient.ensureDirectory).not.toHaveBeenCalled();
    });

    test('SQL実行エラー時にクエリ保存されない', async () => {
      const error = new Error('SQL execution failed');
      (error as any).code = 'SQL_EXECUTION_ERROR';
      vi.mocked(jupyterClient.executeSql).mockRejectedValue(error);

      await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM nonexistent',
        filename: 'result.csv',
      });

      expect(jupyterClient.writeTextFile).not.toHaveBeenCalled();
      expect(jupyterClient.ensureDirectory).not.toHaveBeenCalled();
    });

    test('クエリ保存失敗時に1回リトライされる', async () => {
      vi.mocked(jupyterClient.writeTextFile)
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      expect(jupyterClient.writeTextFile).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('クエリ保存がリトライ後も失敗した場合エラーが返る', async () => {
      vi.mocked(jupyterClient.writeTextFile)
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockRejectedValueOnce(new Error('Write failed again'));

      const result = await executeExecuteSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'users.csv',
      });

      expect(jupyterClient.writeTextFile).toHaveBeenCalledTimes(2);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Write failed');
    });
  });
});
