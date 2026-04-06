/**
 * notebook_reorder_cell ツール実装
 */

import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックのセルを並び替える
 */
export async function executeNotebookReorderCell(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  const cellIndexResult = validateCellIndexParam(args.cell_index);
  if ('error' in cellIndexResult) {
    return createErrorResponse(cellIndexResult.error, 'VALIDATION_ERROR');
  }
  const cellIndex = cellIndexResult.index;

  const toIndexResult = validateCellIndexParam(args.to_index, 'to_index');
  if ('error' in toIndexResult) {
    return createErrorResponse(toIndexResult.error, 'VALIDATION_ERROR');
  }
  const toIndex = toIndexResult.index;

  try {
    // REST API でセルを並び替え
    await jupyterClient.operateCell(validatedPath, {
      action: 'reorder',
      index: cellIndex,
      to_index: toIndex,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_reordered',
      notebook_path: validatedPath,
      cell_index: cellIndex,
      to_index: toIndex,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_index: cellIndex,
      to_index: toIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} をインデックス ${toIndex} に移動しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
