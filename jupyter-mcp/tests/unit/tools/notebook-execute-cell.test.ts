import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookExecuteCell } from '../../../src/tools/notebook-execute-cell.js';
import type { CellExecuteResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient と resolveSession をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    executeCellInNotebook: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveSession: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveSession } from '../../../src/utils/session-resolver.js';

describe('executeNotebookExecuteCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSession).mockResolvedValue({ kernelId: 'kernel-123', notebookPath: 'analysis.ipynb' });
    vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });
  });

  describe('正常系', () => {
    test('セルを再実行でき、stdout と execution_count が返る', async () => {
      const mockResponse: CellExecuteResponse = {
        cell_index: 0,
        source: 'print("Hello, World!")',
        execution_count: 3,
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'Hello, World!\n' }],
        execution_time_ms: 150,
      };

      vi.mocked(jupyterClient.executeCellInNotebook).mockResolvedValue(mockResponse);

      const result = await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        cell_index: 0,
      });

      // resolveSession が呼ばれたことを確認
      expect(resolveSession).toHaveBeenCalledWith('session-123');

      // executeCellInNotebook が正しい引数で呼ばれたことを確認
      expect(jupyterClient.executeCellInNotebook).toHaveBeenCalledWith('analysis.ipynb', 0, {
        kernel_id: 'kernel-123',
        timeout: 30,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('Hello, World!');
      expect(result.content[0].text).toContain('"execution_count": 3');
    });

    test('タイムアウトなしでデフォルト値が使用される', async () => {
      const mockResponse: CellExecuteResponse = {
        cell_index: 2,
        source: 'x = 1 + 1',
        execution_count: 5,
        outputs: [],
        execution_time_ms: 10,
      };

      vi.mocked(jupyterClient.executeCellInNotebook).mockResolvedValue(mockResponse);

      await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        cell_index: 2,
      });

      // timeout を指定しない場合、デフォルト値（30）が使用される
      expect(jupyterClient.executeCellInNotebook).toHaveBeenCalledWith('analysis.ipynb', 2, {
        kernel_id: 'kernel-123',
        timeout: 30,
      });
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteCell({
        session_id: 'session-123',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.executeCellInNotebook).not.toHaveBeenCalled();
    });

    test('session_id 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('session_id');
      expect(jupyterClient.executeCellInNotebook).not.toHaveBeenCalled();
    });

    test('cell_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.executeCellInNotebook).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookExecuteCell({
        notebook_path: '../../../etc/passwd',
        session_id: 'session-123',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.executeCellInNotebook).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('範囲外の cell_index => サーバーエラーが伝播される', async () => {
      const error = new Error('セルインデックスが不正です: 999');
      (error as Record<string, unknown>).code = 'INVALID_CELL_INDEX';
      vi.mocked(jupyterClient.executeCellInNotebook).mockRejectedValue(error);

      const result = await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        cell_index: 999,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });

    test('サーバーエラー => エラーレスポンスが返る', async () => {
      vi.mocked(jupyterClient.executeCellInNotebook).mockRejectedValue(new Error('Connection timeout'));

      const result = await executeNotebookExecuteCell({
        notebook_path: 'analysis.ipynb',
        session_id: 'session-123',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection timeout');
    });
  });
});
