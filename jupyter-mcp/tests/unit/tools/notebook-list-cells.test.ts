import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookListCells } from '../../../src/tools/notebook-list-cells.js';
import type { NotebookResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    getContents: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookListCells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('セル一覧が取得できる（コードセル + マークダウンセル混在）', async () => {
      const mockNotebook: NotebookResponse = {
        path: 'analysis.ipynb',
        type: 'notebook',
        content: {
          cells: [
            {
              cell_type: 'code',
              source: 'import pandas as pd',
              outputs: [],
              execution_count: 1,
            },
            {
              cell_type: 'markdown',
              source: '# 分析結果',
            },
            {
              cell_type: 'code',
              source: 'df = pd.read_csv("data.csv")',
              outputs: [
                {
                  output_type: 'stream',
                  name: 'stdout',
                  text: 'Loaded 100 rows',
                },
              ],
              execution_count: 2,
            },
          ],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.getContents).mockResolvedValue(mockNotebook);

      const result = await executeNotebookListCells({ notebook_path: 'analysis.ipynb' });

      expect(jupyterClient.getContents).toHaveBeenCalledWith('analysis.ipynb');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"total_cells": 3');

      // セル情報が含まれていることを確認
      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed.cells).toHaveLength(3);
      expect(parsed.cells[0].cell_index).toBe(0);
      expect(parsed.cells[0].cell_type).toBe('code');
      expect(parsed.cells[0].source).toBe('import pandas as pd');
      expect(parsed.cells[0].execution_count).toBe(1);
      expect(parsed.cells[1].cell_index).toBe(1);
      expect(parsed.cells[1].cell_type).toBe('markdown');
      expect(parsed.cells[1].source).toBe('# 分析結果');
      expect(parsed.cells[2].cell_index).toBe(2);
      expect(parsed.cells[2].cell_type).toBe('code');
      expect(parsed.cells[2].outputs).toHaveLength(1);
      expect(parsed.cells[2].execution_count).toBe(2);
    });

    test('セルが0件のノートブック', async () => {
      const mockNotebook: NotebookResponse = {
        path: 'empty.ipynb',
        type: 'notebook',
        content: {
          cells: [],
          metadata: {},
        },
        modified_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.getContents).mockResolvedValue(mockNotebook);

      const result = await executeNotebookListCells({ notebook_path: 'empty.ipynb' });

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"total_cells": 0');

      const parsed = JSON.parse(result.content[0].text as string);
      expect(parsed.cells).toHaveLength(0);
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('notebook_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookListCells({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('notebook_path');
      expect(jupyterClient.getContents).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃 => VALIDATION_ERROR', async () => {
      const result = await executeNotebookListCells({ notebook_path: '../../../etc/passwd' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.getContents).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - API エラー', () => {
    test('存在しないノートブック => NOT_FOUND エラー', async () => {
      const error = new Error('ノートブックが見つかりません: nonexistent.ipynb');
      (error as Record<string, unknown>).code = 'NOTEBOOK_NOT_FOUND';
      vi.mocked(jupyterClient.getContents).mockRejectedValue(error);

      const result = await executeNotebookListCells({ notebook_path: 'nonexistent.ipynb' });

      expect(result.content[0].text).toContain('"success": false');
    });
  });
});
