import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookMergeCells } from '../../../src/tools/notebook-merge-cells.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookMergeCells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('隣接する2セルを結合できる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookMergeCells({
        notebook_path: 'analysis.ipynb',
        start_index: 0,
        end_index: 1,
      });

      // operateCell が merge アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'merge',
        start_index: 0,
        end_index: 1,
      });

      // postAiEvent が cells_merged イベントで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cells_merged',
        notebook_path: 'analysis.ipynb',
        start_index: 0,
        end_index: 1,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"start_index": 0');
      expect(result.content[0].text).toContain('"end_index": 1');
    });

    test('3セル以上を結合できる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookMergeCells({
        notebook_path: 'analysis.ipynb',
        start_index: 0,
        end_index: 3,
      });

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'merge',
        start_index: 0,
        end_index: 3,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"start_index": 0');
      expect(result.content[0].text).toContain('"end_index": 3');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookMergeCells({
        start_index: 0,
        end_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('start_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookMergeCells({
        notebook_path: 'analysis.ipynb',
        end_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('start_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('end_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookMergeCells({
        notebook_path: 'analysis.ipynb',
        start_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('end_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookMergeCells({
        notebook_path: '../../../etc/passwd',
        start_index: 0,
        end_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('セルタイプ混在 => CELL_TYPE_MISMATCH エラー', async () => {
      const error = new Error('セルタイプが混在しています');
      (error as Record<string, unknown>).code = 'CELL_TYPE_MISMATCH';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookMergeCells({
        notebook_path: 'analysis.ipynb',
        start_index: 0,
        end_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('CELL_TYPE_MISMATCH');
    });
  });
});
