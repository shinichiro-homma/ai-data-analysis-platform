/**
 * notebook_merge_cells ツール実装
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
 * 隣接する複数セルを1つに結合する
 */
export async function executeNotebookMergeCells(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  const startIndexResult = validateCellIndexParam(args.start_index, 'start_index');
  if ('error' in startIndexResult) {
    return createErrorResponse(startIndexResult.error, 'VALIDATION_ERROR');
  }
  const startIndex = startIndexResult.index;

  const endIndexResult = validateCellIndexParam(args.end_index, 'end_index');
  if ('error' in endIndexResult) {
    return createErrorResponse(endIndexResult.error, 'VALIDATION_ERROR');
  }
  const endIndex = endIndexResult.index;

  try {
    // REST API でセルを結合
    await jupyterClient.operateCell(validatedPath, {
      action: 'merge',
      start_index: startIndex,
      end_index: endIndex,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cells_merged',
      notebook_path: validatedPath,
      start_index: startIndex,
      end_index: endIndex,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      start_index: startIndex,
      end_index: endIndex,
      message: `ノートブック "${validatedPath}" のセル ${startIndex}〜${endIndex} を結合しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
