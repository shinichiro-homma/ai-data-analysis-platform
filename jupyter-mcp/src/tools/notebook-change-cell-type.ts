/**
 * notebook_change_cell_type ツール実装
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
 * セルのタイプを変更する（code ↔ markdown）
 */
export async function executeNotebookChangeCellType(args: Record<string, unknown>): Promise<McpResponse> {
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

  if (args.new_type === undefined || args.new_type === null) {
    return createErrorResponse('new_type は必須パラメータです', 'VALIDATION_ERROR');
  }
  if (args.new_type !== 'code' && args.new_type !== 'markdown') {
    return createErrorResponse(
      `new_type は "code" または "markdown" のいずれかです。指定値: ${String(args.new_type)}`,
      'VALIDATION_ERROR',
    );
  }
  const newType = args.new_type as 'code' | 'markdown';

  try {
    // REST API でセルタイプを変更
    await jupyterClient.operateCell(validatedPath, {
      action: 'change_type',
      index: cellIndex,
      cell_type: newType,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_type_changed',
      notebook_path: validatedPath,
      cell_index: cellIndex,
      new_type: newType,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_index: cellIndex,
      new_type: newType,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} のタイプを "${newType}" に変更しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
