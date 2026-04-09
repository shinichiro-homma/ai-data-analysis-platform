import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookExecuteBatch } from '../../../src/tools/notebook-execute-batch.js';
import type { CellExecuteBatchResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient と resolveSession をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    executeBatchCells: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveSession: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveSession } from '../../../src/utils/session-resolver.js';

describe('executeNotebookExecuteBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'analysis.ipynb' });
  });

  describe('正常系', () => {
    test('mode: all で一括実行成功', async () => {
      const mockResponse: CellExecuteBatchResponse = {
        executed_cells: 5,
        success_count: 5,
        failed_cell: null,
      };

      vi.mocked(jupyterClient.executeBatchCells).mockResolvedValue(mockResponse);

      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'all',
      });

      // resolveSession が呼ばれたことを確認
      expect(resolveSession).toHaveBeenCalledWith('session-123');

      // executeBatchCells が正しい引数で呼ばれたことを確認
      expect(jupyterClient.executeBatchCells).toHaveBeenCalledWith('analysis.ipynb', {
        kernel_id: 'kernel-123',
        mode: 'all',
        timeout: 30,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"executed_cells": 5');
      expect(result.content[0].text).toContain('"success_count": 5');
    });

    test('mode: up_to + cell_index で部分実行成功', async () => {
      const mockResponse: CellExecuteBatchResponse = {
        executed_cells: 3,
        success_count: 3,
        failed_cell: null,
      };

      vi.mocked(jupyterClient.executeBatchCells).mockResolvedValue(mockResponse);

      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'up_to',
        cell_index: 4,
      });

      expect(jupyterClient.executeBatchCells).toHaveBeenCalledWith('analysis.ipynb', {
        kernel_id: 'kernel-123',
        mode: 'up_to',
        cell_index: 4,
        timeout: 30,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"executed_cells": 3');
    });

    test('mode: from + cell_index で部分実行成功', async () => {
      const mockResponse: CellExecuteBatchResponse = {
        executed_cells: 2,
        success_count: 2,
        failed_cell: null,
      };

      vi.mocked(jupyterClient.executeBatchCells).mockResolvedValue(mockResponse);

      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'from',
        cell_index: 3,
      });

      expect(jupyterClient.executeBatchCells).toHaveBeenCalledWith('analysis.ipynb', {
        kernel_id: 'kernel-123',
        mode: 'from',
        cell_index: 3,
        timeout: 30,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"executed_cells": 2');
    });

    test('timeout オプション指定', async () => {
      const mockResponse: CellExecuteBatchResponse = {
        executed_cells: 1,
        success_count: 1,
        failed_cell: null,
      };

      vi.mocked(jupyterClient.executeBatchCells).mockResolvedValue(mockResponse);

      await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'all',
        timeout: 60,
      });

      expect(jupyterClient.executeBatchCells).toHaveBeenCalledWith('analysis.ipynb', {
        kernel_id: 'kernel-123',
        mode: 'all',
        timeout: 60,
      });
    });
  });

  describe('KeyboardInterrupt 対応', () => {
    test('KeyboardInterrupt 発生時にエラー種別が MCP レスポンスに含まれる', async () => {
      // サーバーは KeyboardInterrupt 時に error フィールドを返す
      const mockResponse: CellExecuteBatchResponse = {
        executed_cells: 3,
        success_count: 2,
        failed_cell: 2,
        error: {
          type: 'KeyboardInterrupt',
          message: '',
          traceback: ['\u001b[0;31mKeyboardInterrupt\u001b[0m: '],
        },
      };

      vi.mocked(jupyterClient.executeBatchCells).mockResolvedValue(mockResponse);

      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'all',
      });

      const responseText = result.content[0].text;
      expect(responseText).toContain('KeyboardInterrupt');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        session_id: 'session-123',
        mode: 'all',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });

    test('session_id 未指定で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        mode: 'all',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('session_id');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });

    test('mode 未指定で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('mode');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });

    test('mode が不正値で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'invalid_mode',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });

    test('up_to で cell_index 未指定で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'up_to',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃で VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteBatch({
        notebook_path: '../../../etc/passwd',
        session_id: 'session-123',
        mode: 'all',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.executeBatchCells).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('サーバーエラー伝播', async () => {
      vi.mocked(jupyterClient.executeBatchCells).mockRejectedValue(new Error('Connection timeout'));

      const result = await executeNotebookExecuteBatch({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        mode: 'all',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection timeout');
    });
  });
});
