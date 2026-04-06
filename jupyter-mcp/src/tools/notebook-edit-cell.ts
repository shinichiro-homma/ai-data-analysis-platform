/**
 * notebook_edit_cell ツール実装
 */

import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import {
  validateStringParameter,
  validateAndNormalizeNotebookPath,
  validateCellIndexParam,
} from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックのセルを編集する
 */
export async function executeNotebookEditCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  // 入力検証: source
  const sourceValidation = validateStringParameter(args.source, 'source', {
    required: true,
    maxLength: 1000000,
    allowEmpty: true,
  });
  if (!sourceValidation.isValid) {
    return createErrorResponse(sourceValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const source = args.source as string;

  try {
    // REST API でセルを更新
    await jupyterClient.operateCell(validatedPath, {
      action: 'update',
      index: cellIndex,
      cell: {
        source,
      },
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_edited',
      notebook_path: validatedPath,
      cell_index: cellIndex,
      source,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_index: cellIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を編集しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
