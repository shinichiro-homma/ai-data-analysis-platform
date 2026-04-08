import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookCopyCell } from '../../../src/tools/notebook-copy-cell.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookCopyCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セルを指定位置にコピーできる（target_index 指定）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookCopyCell({
        notebook_path: 'analysis.ipynb',
        source_index: 0,
        target_index: 2,
      });

      // operateCell が copy アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'copy',
        index: 0,
        to_index: 2,
      });

      // postAiEvent が cell_copied イベントで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_copied',
        notebook_path: 'analysis.ipynb',
        source_index: 0,
        target_index: 2,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"source_index": 0');
      expect(result.content[0].text).toContain('"target_index": 2');
    });

    test('target_index 省略時はソースの直後にコピーされる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookCopyCell({
        notebook_path: 'analysis.ipynb',
        source_index: 1,
      });

      // target_index 省略時、MCP ツール側で source_index + 1 をデフォルトとして渡す
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'copy',
        index: 1,
        to_index: 2,
      });

      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'cell_copied',
        notebook_path: 'analysis.ipynb',
        source_index: 1,
        target_index: 2,
      });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"source_index": 1');
      expect(result.content[0].text).toContain('"target_index": 2');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookCopyCell({
        source_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('source_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookCopyCell({
        notebook_path: 'analysis.ipynb',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('source_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookCopyCell({
        notebook_path: '../../../etc/passwd',
        source_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('範囲外の source_index => INVALID_CELL_INDEX エラー', async () => {
      const error = new Error('セルインデックスが不正です: 999');
      (error as Record<string, unknown>).code = 'INVALID_CELL_INDEX';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookCopyCell({
        notebook_path: 'analysis.ipynb',
        source_index: 999,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });
  });
});
