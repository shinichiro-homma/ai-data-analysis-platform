/**
 * cell-operations ユーティリティのテスト
 *
 * 22.1: operateCellWithSync ヘルパーのテスト
 * - 正常系: operateCell → postAiEvent → createSuccessResponse の順序で呼ばれる
 * - 異常系: operateCell 失敗時にエラーレスポンスが返る
 * - 異常系: postAiEvent 失敗時にエラーレスポンスが返る
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
import type { CellOperationRequest, AiEvent } from '../../../src/jupyter-client/types.js';

describe('operateCellWithSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('operateCell → postAiEvent → 成功レスポンスの順に実行される', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 1 });

      const operation: CellOperationRequest = {
        action: 'update',
        index: 0,
        cell: { source: 'print("hello")' },
      };

      const event: AiEvent = {
        type: 'cell_edited',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        source: 'print("hello")',
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      // operateCell が正しい引数で呼ばれたことを確認
      expect(jupyterClient.operateCell).toHaveBeenCalledWith('analysis.ipynb', operation);

      // postAiEvent が正しい引数で呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith(event);

      // operateCell が postAiEvent より先に呼ばれたことを確認
      const operateCellOrder = vi.mocked(jupyterClient.operateCell).mock.invocationCallOrder[0];
      const postAiEventOrder = vi.mocked(jupyterClient.postAiEvent).mock.invocationCallOrder[0];
      expect(operateCellOrder).toBeLessThan(postAiEventOrder);

      // 成功レスポンスが返されることを確認
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
      expect(result.content[0].text).toContain('"cell_index": 0');
    });

    test('delete アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const operation: CellOperationRequest = {
        action: 'delete',
        index: 2,
      };

      const event: AiEvent = {
        type: 'cell_deleted',
        notebook_path: 'test.ipynb',
        cell_index: 2,
      };

      const successPayload = {
        notebook_path: 'test.ipynb',
        cell_index: 2,
        message: 'セルを削除しました',
      };

      const result = await operateCellWithSync('test.ipynb', operation, event, successPayload);

      expect(jupyterClient.operateCell).toHaveBeenCalledWith('test.ipynb', operation);
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith(event);
      expect(result.content[0].text).toContain('"success": true');
    });

    test('reorder アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 1 });

      const operation: CellOperationRequest = {
        action: 'reorder',
        index: 0,
        to_index: 3,
      };

      const event: AiEvent = {
        type: 'cell_reordered',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        to_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        to_index: 3,
        message: 'セルを移動しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"to_index": 3');
    });

    test('merge アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const operation: CellOperationRequest = {
        action: 'merge',
        start_index: 1,
        end_index: 3,
      };

      const event: AiEvent = {
        type: 'cells_merged',
        notebook_path: 'analysis.ipynb',
        start_index: 1,
        end_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        start_index: 1,
        end_index: 3,
        message: 'セルを結合しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"start_index": 1');
      expect(result.content[0].text).toContain('"end_index": 3');
    });

    test('split アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 1 });

      const operation: CellOperationRequest = {
        action: 'split',
        index: 0,
        split_line: 5,
      };

      const event: AiEvent = {
        type: 'cell_split',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        split_line: 5,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        split_line: 5,
        message: 'セルを分割しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"split_line": 5');
    });

    test('change_type アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const operation: CellOperationRequest = {
        action: 'change_type',
        index: 1,
        cell_type: 'markdown',
      };

      const event: AiEvent = {
        type: 'cell_type_changed',
        notebook_path: 'analysis.ipynb',
        cell_index: 1,
        new_type: 'markdown',
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 1,
        new_type: 'markdown',
        message: 'セルタイプを変更しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"new_type": "markdown"');
    });

    test('copy アクションで正しく動作する', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 1 });

      const operation: CellOperationRequest = {
        action: 'copy',
        index: 2,
        to_index: 3,
      };

      const event: AiEvent = {
        type: 'cell_copied',
        notebook_path: 'analysis.ipynb',
        source_index: 2,
        target_index: 3,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        source_index: 2,
        target_index: 3,
        message: 'セルをコピーしました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"source_index": 2');
      expect(result.content[0].text).toContain('"target_index": 3');
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

      const event: AiEvent = {
        type: 'cell_edited',
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        source: 'print("hello")',
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 999,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INVALID_CELL_INDEX');
      // postAiEvent は呼ばれないことを確認（operateCell で失敗したため）
      expect(jupyterClient.postAiEvent).not.toHaveBeenCalled();
    });

    test('postAiEvent 失敗時にエラーレスポンスが返る', async () => {
      vi.mocked(jupyterClient.operateCell).mockResolvedValue(undefined);
      const error = new Error('WebSocket broadcast failed');
      (error as Record<string, unknown>).code = 'CONNECTION_ERROR';
      vi.mocked(jupyterClient.postAiEvent).mockRejectedValue(error);

      const operation: CellOperationRequest = {
        action: 'delete',
        index: 0,
      };

      const event: AiEvent = {
        type: 'cell_deleted',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        message: 'セルを削除しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('CONNECTION_ERROR');
      // operateCell は呼ばれていることを確認
      expect(jupyterClient.operateCell).toHaveBeenCalled();
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

      const event: AiEvent = {
        type: 'cell_edited',
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        source: 'x = 1',
      };

      const successPayload = {
        notebook_path: 'analysis.ipynb',
        cell_index: 0,
        message: 'セルを編集しました',
      };

      const result = await operateCellWithSync('analysis.ipynb', operation, event, successPayload);

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('CONNECTION_ERROR');
    });
  });
});
