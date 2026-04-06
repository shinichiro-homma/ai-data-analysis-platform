/**
 * notebook_delete_cell ツール実装
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
 * ノートブックのセルを削除する
 */
export async function executeNotebookDeleteCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  try {
    // REST API でセルを削除
    await jupyterClient.operateCell(validatedPath, {
      action: 'delete',
      index: cellIndex,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_deleted',
      notebook_path: validatedPath,
      cell_index: cellIndex,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_index: cellIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を削除しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
