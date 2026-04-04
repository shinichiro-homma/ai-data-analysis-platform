import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeDataPreview } from '../../../src/tools/data-preview.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    getDataPreview: vi.fn(),
  },
}));

// workspace-path-store をモック（resolveWorkspacePath が API 呼び出しを行わないようにする）
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeDataPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('CSV ファイルのプレビューが取得できる（カラム名・型・先頭行・行数）', async () => {
      const mockPreview = {
        path: 'data/sales.csv',
        format: 'csv',
        row_count: 100,
        columns: [
          { name: 'id', dtype: 'int64' },
          { name: 'name', dtype: 'object' },
          { name: 'amount', dtype: 'float64' },
        ],
        head: [
          { id: 1, name: 'Product A', amount: 100.5 },
          { id: 2, name: 'Product B', amount: 200.0 },
          { id: 3, name: 'Product C', amount: 300.0 },
          { id: 4, name: 'Product D', amount: 400.0 },
          { id: 5, name: 'Product E', amount: 500.0 },
        ],
        file_size_bytes: 2048,
      };

      vi.mocked(jupyterClient.getDataPreview).mockResolvedValue(mockPreview);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/sales.csv',
      });

      expect(jupyterClient.getDataPreview).toHaveBeenCalledWith('workspaces/ws-abc123/data/sales.csv', {
        head_rows: 5,
      });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"format": "csv"');
      expect(result.content[0].text).toContain('"row_count": 100');
      expect(result.content[0].text).toContain('id');
      expect(result.content[0].text).toContain('int64');
      expect(result.content[0].text).toContain('Product A');
    });

    test('Parquet ファイルのプレビューが取得できる', async () => {
      const mockPreview = {
        path: 'data/transactions.parquet',
        format: 'parquet',
        row_count: 50000,
        columns: [
          { name: 'transaction_id', dtype: 'int64' },
          { name: 'date', dtype: 'datetime64[ns]' },
          { name: 'amount', dtype: 'float64' },
        ],
        head: [
          { transaction_id: 1, date: '2024-01-01', amount: 1500.0 },
          { transaction_id: 2, date: '2024-01-02', amount: 2500.0 },
        ],
        file_size_bytes: 102400,
      };

      vi.mocked(jupyterClient.getDataPreview).mockResolvedValue(mockPreview);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/transactions.parquet',
      });

      expect(jupyterClient.getDataPreview).toHaveBeenCalledWith('workspaces/ws-abc123/data/transactions.parquet', {
        head_rows: 5,
      });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"format": "parquet"');
      expect(result.content[0].text).toContain('"row_count": 50000');
      expect(result.content[0].text).toContain('transaction_id');
      expect(result.content[0].text).toContain('datetime64[ns]');
    });

    test('head_rows を指定して先頭行数を変更できる', async () => {
      const mockPreview = {
        path: 'data/sales.csv',
        format: 'csv',
        row_count: 100,
        columns: [{ name: 'id', dtype: 'int64' }],
        head: [{ id: 1 }, { id: 2 }, { id: 3 }],
        file_size_bytes: 2048,
      };

      vi.mocked(jupyterClient.getDataPreview).mockResolvedValue(mockPreview);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/sales.csv',
        head_rows: 3,
      });

      expect(jupyterClient.getDataPreview).toHaveBeenCalledWith('workspaces/ws-abc123/data/sales.csv', {
        head_rows: 3,
      });
      expect(result.content[0].text).toContain('"success": true');
    });

    test('head_rows 未指定時にデフォルト（5行）が使用される', async () => {
      const mockPreview = {
        path: 'data/sales.csv',
        format: 'csv',
        row_count: 10,
        columns: [{ name: 'id', dtype: 'int64' }],
        head: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
        file_size_bytes: 512,
      };

      vi.mocked(jupyterClient.getDataPreview).mockResolvedValue(mockPreview);

      await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/sales.csv',
      });

      // head_rows 未指定 => デフォルト 5 で呼ばれることを確認
      expect(jupyterClient.getDataPreview).toHaveBeenCalledWith('workspaces/ws-abc123/data/sales.csv', {
        head_rows: 5,
      });
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeDataPreview({ file_path: 'data/sales.csv' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.getDataPreview).not.toHaveBeenCalled();
    });

    test('file_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeDataPreview({ workspace_id: 'ws-abc123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('file_path');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.getDataPreview).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: '../../../etc/passwd',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.getDataPreview).not.toHaveBeenCalled();
    });

    test('head_rows が負数 => VALIDATION_ERROR', async () => {
      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/sales.csv',
        head_rows: -1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.getDataPreview).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('非対応形式 => UNSUPPORTED_FORMAT エラー', async () => {
      const error = new Error('UNSUPPORTED_FORMAT');
      (error as Record<string, unknown>).code = 'UNSUPPORTED_FORMAT';
      (error as Record<string, unknown>).statusCode = 400;
      vi.mocked(jupyterClient.getDataPreview).mockRejectedValue(error);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/image.png',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('UNSUPPORTED_FORMAT');
    });

    test('ファイルが存在しない => NOT_FOUND エラー', async () => {
      const error = new Error('NOT_FOUND');
      (error as Record<string, unknown>).code = 'NOT_FOUND';
      (error as Record<string, unknown>).statusCode = 404;
      vi.mocked(jupyterClient.getDataPreview).mockRejectedValue(error);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/nonexistent.csv',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('NOT_FOUND');
    });

    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.getDataPreview).mockRejectedValue(error);

      const result = await executeDataPreview({
        workspace_id: 'ws-abc123',
        file_path: 'data/sales.csv',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
