import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeExportSql } from '../../../src/tools/export-sql.js';
import type { SqlExportResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    exportSql: vi.fn(),
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

describe('executeExportSql', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // デフォルト: ワークスペースID解決成功
    vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({ workspaceId: 'ws-abc123' });
  });

  describe('正常系', () => {
    test('Parquet エクスポート成功（format 未指定 => デフォルト parquet）', async () => {
      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/export.parquet',
        row_count: 5000,
        file_size_bytes: 65536,
        format: 'parquet',
        execution_time_ms: 1200,
      };

      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM transactions',
        filename: 'export.parquet',
      });

      expect(resolveWorkspaceIdOrError).toHaveBeenCalledWith('session-123');
      expect(jupyterClient.exportSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM transactions',
        workspace_id: 'ws-abc123',
        file_path: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.file_path).toBe('workspaces/ws-abc123/data/export.parquet');
      expect(parsed.row_count).toBe(5000);
      expect(parsed.file_size_bytes).toBe(65536);
      expect(parsed.format).toBe('parquet');
      expect(parsed.execution_time_ms).toBe(1200);
    });

    test('CSV エクスポート成功（format: "csv" 指定）', async () => {
      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/export.csv',
        row_count: 3000,
        file_size_bytes: 32768,
        format: 'csv',
        execution_time_ms: 800,
      };

      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.csv',
        format: 'csv',
      });

      expect(jupyterClient.exportSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users',
        workspace_id: 'ws-abc123',
        file_path: 'export.csv',
        format: 'csv',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.format).toBe('csv');
      expect(parsed.row_count).toBe(3000);
    });

    test('timeout オプション指定が正しく渡される', async () => {
      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/export.parquet',
        row_count: 10000,
        file_size_bytes: 131072,
        format: 'parquet',
        execution_time_ms: 5000,
      };

      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM large_table',
        filename: 'export.parquet',
        timeout: 500,
      });

      expect(jupyterClient.exportSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM large_table',
        workspace_id: 'ws-abc123',
        file_path: 'export.parquet',
        timeout: 500,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    test('レスポンスに file_path, row_count, file_size_bytes, format, execution_time_ms が含まれる', async () => {
      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/result.parquet',
        row_count: 2500,
        file_size_bytes: 49152,
        format: 'parquet',
        execution_time_ms: 900,
      };

      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT id, name FROM users',
        filename: 'result.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty('file_path');
      expect(parsed).toHaveProperty('row_count');
      expect(parsed).toHaveProperty('file_size_bytes');
      expect(parsed).toHaveProperty('format');
      expect(parsed).toHaveProperty('execution_time_ms');
    });

    test('data/ プレフィックス付き filename が自動除去されてサーバーに送信される', async () => {
      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/otac_washing.parquet',
        row_count: 100,
        file_size_bytes: 4096,
        format: 'parquet',
        execution_time_ms: 500,
      };

      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM some_table',
        filename: 'data/otac_washing.parquet',
      });

      // data/ が除去されて "otac_washing.parquet" がサーバーに送信される
      expect(jupyterClient.exportSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM some_table',
        workspace_id: 'ws-abc123',
        file_path: 'otac_washing.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });
  });

  describe('バリデーションエラー', () => {
    test('session_id 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('session_id');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('sql 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: 'session-123',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('sql');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('filename 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('filename');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('session_id 空文字 => VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: '',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('format に不正値（"xlsx"）=> VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.xlsx',
        format: 'xlsx',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('format');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('timeout が 600 超 => VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
        timeout: 601,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('timeout');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('パストラバーサル（../evil.parquet）=> VALIDATION_ERROR', async () => {
      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: '../evil.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });
  });

  describe('APIエラー', () => {
    test('SQL_NOT_ALLOWED（非SELECT文）=> エラー返却', async () => {
      const error = new Error('Only SELECT statements are allowed for export');
      (error as any).code = 'SQL_NOT_ALLOWED';

      vi.mocked(jupyterClient.exportSql).mockRejectedValue(error);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'INSERT INTO users (name) VALUES (\'Alice\')',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_NOT_ALLOWED');
    });

    test('SQL_EXECUTION_ERROR => エラー返却', async () => {
      const error = new Error('SQL execution failed. Check your query syntax.');
      (error as any).code = 'SQL_EXECUTION_ERROR';

      vi.mocked(jupyterClient.exportSql).mockRejectedValue(error);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM nonexistent_table',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_EXECUTION_ERROR');
    });

    test('DATABASE_CONNECTION_ERROR => エラー返却 with isError flag', async () => {
      const error = new Error('Could not connect to database.');
      (error as any).code = 'DATABASE_CONNECTION_ERROR';

      vi.mocked(jupyterClient.exportSql).mockRejectedValue(error);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('DATABASE_CONNECTION_ERROR');
    });

    test('SQL_TIMEOUT => エラー返却', async () => {
      const error = new Error('Query execution timed out after 300 seconds');
      (error as any).code = 'SQL_TIMEOUT';

      vi.mocked(jupyterClient.exportSql).mockRejectedValue(error);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM large_table',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('SQL_TIMEOUT');
    });

    test('FILE_WRITE_ERROR => エラー返却', async () => {
      const error = new Error('Failed to write export file');
      (error as any).code = 'FILE_WRITE_ERROR';

      vi.mocked(jupyterClient.exportSql).mockRejectedValue(error);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('FILE_WRITE_ERROR');
    });

    test('resolveWorkspaceIdOrError がフォールバック経由で workspace_id を返す場合も正常動作する', async () => {
      // resolveWorkspaceIdOrError は内部で notebookPath → sessionWorkspaceStore のフォールバックを行う
      vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({ workspaceId: 'ws-abc123' });

      const mockResult: SqlExportResponse = {
        success: true,
        file_path: 'workspaces/ws-abc123/data/export.parquet',
        row_count: 100,
        file_size_bytes: 4096,
        format: 'parquet',
        execution_time_ms: 200,
      };
      vi.mocked(jupyterClient.exportSql).mockResolvedValue(mockResult);

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(jupyterClient.exportSql).toHaveBeenCalledWith({
        sql: 'SELECT * FROM users',
        workspace_id: 'ws-abc123',
        file_path: 'export.parquet',
      });
    });

    test('WORKSPACE_NOT_FOUND（resolveWorkspaceIdOrError がエラーを返す）=> エラー返却', async () => {
      vi.mocked(resolveWorkspaceIdOrError).mockResolvedValue({
        error: {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: { code: 'WORKSPACE_NOT_FOUND', message: 'セッションからワークスペースIDを特定できません。' } }) }],
          isError: true,
        },
      });

      const result = await executeExportSql({
        session_id: 'session-123',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('WORKSPACE_NOT_FOUND');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });

    test('セッション解決失敗 => エラー返却', async () => {
      vi.mocked(resolveWorkspaceIdOrError).mockRejectedValue(new Error('Session not found'));

      const result = await executeExportSql({
        session_id: 'nonexistent',
        sql: 'SELECT * FROM users',
        filename: 'export.parquet',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error.message).toContain('Session not found');
      expect(jupyterClient.exportSql).not.toHaveBeenCalled();
    });
  });
});
