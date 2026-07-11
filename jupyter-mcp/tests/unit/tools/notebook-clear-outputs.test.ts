import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookClearOutputs } from '../../../src/tools/notebook-clear-outputs.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    clearAllOutputs: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookClearOutputs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('単一セルの出力クリア（cell_index 指定）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookClearOutputs({
        notebook_path: 'analysis.ipynb',
        cell_index: 2,
      });

      // operateCell が clear_output アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'clear_output',
        index: 2,
      });

      // postAiEvent は差分イベント廃止により呼ばれないことを確認
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 2');
    });

    test('全セルの出力クリア（cell_index 省略）', async () => {
      vi.mocked(jupyterClient.clearAllOutputs).mockResolvedValue({ cleared_cells: 3 });
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookClearOutputs({
        notebook_path: 'analysis.ipynb',
      });

      // clearAllOutputs が呼ばれたことを確認
      expect(jupyterClient.clearAllOutputs).toHaveBeenCalledWith('analysis.ipynb');

      // operateCell は呼ばれないこと
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();

      // postAiEvent は差分イベント廃止により呼ばれないことを確認
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
    });

    test('レスポンス形式確認（success フラグ、メッセージ）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookClearOutputs({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      const responseText = result.content[0].text;
      const responseJson = JSON.parse(responseText);

      expect(responseJson.success).toBe(true);
      expect(responseJson.notebook_path).toBe('analysis.ipynb');
      expect(responseJson.cell_index).toBe(0);
      expect(typeof responseJson.message).toBe('string');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookClearOutputs({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
      expect(jupyterClient.clearAllOutputs).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookClearOutputs({
        notebook_path: '../../../etc/passwd',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index に非数値が指定された場合 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookClearOutputs({
        notebook_path: 'analysis.ipynb',
        cell_index: 'abc',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('単一セルクリアの API エラー', async () => {
      const error = new Error('セルインデックスが不正です: 999');
      (error as Record<string, unknown>).code = 'INVALID_CELL_INDEX';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookClearOutputs({
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });

    test('全セルクリアの API エラー', async () => {
      const error = new Error('ノートブックが見つかりません');
      (error as Record<string, unknown>).code = 'NOTEBOOK_NOT_FOUND';
      vi.mocked(jupyterClient.clearAllOutputs).mockRejectedValue(error);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeNotebookClearOutputs({
        notebook_path: 'nonexistent.ipynb',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('NOTEBOOK_NOT_FOUND');
    });
  });
});
