import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookReorderCell } from '../../../src/tools/notebook-reorder-cell.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookReorderCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セルを前方に移動できる（index=2 → to_index=0）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 2,
        to_index: 0,
      });

      // operateCell が reorder アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'reorder',
        index: 2,
        to_index: 0,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 2');
      expect(result.content[0].text).toContain('"to_index": 0');
    });

    test('セルを後方に移動できる（index=0 → to_index=2）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        to_index: 2,
      });

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'reorder',
        index: 0,
        to_index: 2,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"cell_index": 0');
      expect(result.content[0].text).toContain('"to_index": 2');
    });

    test('移動元と移動先が同じ場合に正常終了する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 1,
        to_index: 1,
      });

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'reorder',
        index: 1,
        to_index: 1,
      });

      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        cell_index: 0,
        to_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        to_index: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('to_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('to_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index が負数 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: -1,
        to_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('to_index が負数 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        to_index: -1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('to_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookReorderCell({
        notebook_path: '../../../etc/passwd',
        cell_index: 0,
        to_index: 1,
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

      const result = await executeNotebookReorderCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        to_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });
  });
});
