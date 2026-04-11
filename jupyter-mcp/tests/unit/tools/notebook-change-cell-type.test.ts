import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookChangeCellType } from '../../../src/tools/notebook-change-cell-type.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookChangeCellType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セルタイプを変更できる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        new_type: 'markdown',
      });

      // operateCell が change_type アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'change_type',
        index: 0,
        cell_type: 'markdown',
      });

      // postAiEvent が cell_type_changed イベントで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_type_changed',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        new_type: 'markdown',
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 0');
      expect(result.content[0].text).toContain('"new_type": "markdown"');
    });

    test('code タイプへの変更でレスポンスが正しい', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        cell_index: 2,
        new_type: 'code',
      });

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'change_type',
        index: 2,
        cell_type: 'code',
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"new_type": "code"');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookChangeCellType({
        cell_index: 0,
        new_type: 'markdown',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        new_type: 'markdown',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('new_type 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('new_type');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('無効な new_type 値 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        new_type: 'raw',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookChangeCellType({
        notebook_path: '../../../etc/passwd',
        cell_index: 0,
        new_type: 'markdown',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('範囲外の cell_index => INVALID_CELL_INDEX エラー', async () => {
      const error = new Error('セルインデックスが不正です: 999');
      (error as Record<string, unknown>).code = 'INVALID_CELL_INDEX';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookChangeCellType({
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        new_type: 'markdown',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });
  });
});
