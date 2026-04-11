import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookSplitCell } from '../../../src/tools/notebook-split-cell.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookSplitCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セルを指定行で分割できる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookSplitCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        split_line: 2,
      });

      // operateCell が split アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'split',
        index: 0,
        split_line: 2,
      });

      // postAiEvent が cell_split イベントで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_split',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        split_line: 2,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 0');
      expect(result.content[0].text).toContain('"split_line": 2');
    });

    test('split_line=1 で先頭行のみを前半にできる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookSplitCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 1,
        split_line: 1,
      });

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'split',
        index: 1,
        split_line: 1,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"cell_index": 1');
      expect(result.content[0].text).toContain('"split_line": 1');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookSplitCell({
        cell_index: 0,
        split_line: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookSplitCell({
        notebook_path: 'analysis.ipynb',
        split_line: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('split_line 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookSplitCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('split_line');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookSplitCell({
        notebook_path: '../../../etc/passwd',
        cell_index: 0,
        split_line: 1,
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

      const result = await executeNotebookSplitCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        split_line: 1,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });
  });
});
