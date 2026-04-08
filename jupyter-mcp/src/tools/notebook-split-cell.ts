/**
 * notebook_split_cell ツール実装
 */

import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import {
  validateAndNormalizeNotebookPath,
  validateCellIndexParam,
  validatePositiveIntegerParam,
} from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * 1つのセルを指定行で2つに分割する
 */
export async function executeNotebookSplitCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  const splitLineResult = validatePositiveIntegerParam(args.split_line, 'split_line');
  if ('error' in splitLineResult) {
    return createErrorResponse(splitLineResult.error, 'VALIDATION_ERROR');
  }
  const splitLine = splitLineResult.value;

  try {
    // REST API でセルを分割
    await jupyterClient.operateCell(validatedPath, {
      action: 'split',
      index: cellIndex,
      split_line: splitLine,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_split',
      notebook_path: validatedPath,
      cell_index: cellIndex,
      split_line: splitLine,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_index: cellIndex,
      split_line: splitLine,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を行 ${splitLine} で分割しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
