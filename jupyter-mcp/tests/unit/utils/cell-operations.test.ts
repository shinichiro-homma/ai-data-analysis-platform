/**
 * cell-operations ユーティリティのテスト
 *
 * operateCellWithSync は operateCell → 成功レスポンスのみ。
 * postAiEvent は呼ばない。
 *
 * addCellWithSync も postAiEvent を呼ばない。
 * operateCell のみでディスクに書き込む。
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    operateCell: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { operateCellWithSync } from '../../../src/utils/cell-operations.js';
import type { CellOperationRequest } from '../../../src/jupyter-client/types.js';

describe('operateCellWithSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('operateCell → 成功レスポンス（postAiEvent は呼ばれない）', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'update',
        index: 0,
        cell: { source: 'print("hello")' },
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      // operateCell が正しい引数で呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', operation);

      // postAiEvent は呼ばれないことを確認（差分イベント配信廃止）
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();

      // 成功レスポンスが返されることを確認
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 0');
    });

    test('delete アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'delete',
        index: 2,
      };

      const successPayload = {
        notebook_path: 'test.ipynb',
        cell_index: 2,
        message: 'セルを削除しました',
      };

      const result = await operateCellWithSync('test.ipynb', operation, successPayload);

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('test.ipynb', operation);
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });

    test('reorder アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'reorder',
        index: 0,
        to_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        to_index: 3,
        message: 'セルを移動しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });

    test('merge アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'merge',
        start_index: 1,
        end_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        start_index: 1,
        end_index: 3,
        message: 'セルを結合しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });

    test('split アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'split',
        index: 0,
        split_line: 5,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        split_line: 5,
        message: 'セルを分割しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });

    test('change_type アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'change_type',
        index: 1,
        cell_type: 'markdown',
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 1,
        new_type: 'markdown',
        message: 'セルタイプを変更しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });

    test('copy アクションで postAiEvent が呼ばれない', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);

      const operation: CellOperationRequest = {
        action: 'copy',
        index: 2,
        to_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        source_index: 2,
        target_index: 3,
        message: 'セルをコピーしました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('異常系', () => {
    test('operateCell 失敗時にエラーレスポンスが返る', async () => {
      const error = new Error('セルインデックスが不正です: 999');
      (error as Record<string, unknown>).code = 'INVALID_CELL_INDEX';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);

      const operation: CellOperationRequest = {
        action: 'update',
        index: 999,
        cell: { source: 'print("hello")' },
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
      // postAiEvent は呼ばれないことを確認
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
    });

    test('接続エラー時にエラーレスポンスが返る', async () => {
      const error = new Error('jupyter-server への接続に失敗しました');
      (error as Record<string, unknown>).code = 'CONNECTION_ERROR';
      vi.mocked(jupyterClient.operateCell).mockRejectedValue(error);

      const operation: CellOperationRequest = {
        action: 'update',
        index: 0,
        cell: { source: 'x = 1' },
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, successPayload);

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('CONNECTION_ERROR');
    });
  });
});
