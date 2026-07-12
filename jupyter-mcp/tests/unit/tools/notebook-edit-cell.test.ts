import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookEditCell } from '../../../src/tools/notebook-edit-cell.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookEditCell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セルのソースコードを更新できる', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const result = await executeNotebookEditCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        source: 'import pandas as pd\nimport numpy as np',
      });

      // operateCell が update アクションで呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', {
        action: 'update',
        index: 0,
        cell: {
          source: 'import pandas as pd\nimport numpy as np',
        },
      });

      // postAiEvent は呼ばれないこと（差分イベント配信廃止: タスク 21.3）
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 0');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookEditCell({
        cell_index: 0,
        source: 'print("hello")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('cell_index 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookEditCell({
        notebook_path: 'analysis.ipynb',
        source: 'print("hello")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('cell_index');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('source 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookEditCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('source');
      expect(jupyterClient.operateCell).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookEditCell({
        notebook_path: '../../../etc/passwd',
        cell_index: 0,
        source: 'malicious code',
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

      const result = await executeNotebookEditCell({
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        source: 'print("hello")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
    });
  });
});
