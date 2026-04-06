/**
 * notebook_reorder_cell ツール実装
 */

import { normalizeNotebookPath } from '../utils/path-validator.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter, validateCellIndex } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックのセルを並び替える
 */
export async function executeNotebookReorderCell(args: Record<string, unknown>): Promise<McpResponse> {
  // 入力検証: notebook_path
  const notebookPathValidation = validateStringParameter(args.notebook_path, 'notebook_path', {
    required: true,
    maxLength: 500,
    allowEmpty: false,
  });
  if (!notebookPathValidation.isValid) {
    return createErrorResponse(notebookPathValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const notebookPath = args.notebook_path as string;

  // 入力検証: cell_index (移動元)
  const cellIndexValidation = validateCellIndex(args.cell_index);
  if (!cellIndexValidation.isValid) {
    return createErrorResponse(cellIndexValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const cellIndex = args.cell_index as number;

  // 入力検証: to_index (移動先)
  const toIndexValidation = validateCellIndex(args.to_index, 'to_index');
  if (!toIndexValidation.isValid) {
    return createErrorResponse(toIndexValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const toIndex = args.to_index as number;

  // パストラバーサル攻撃対策（正規化済みパスを以降で使用）
  let validatedPath: string;
  try {
    validatedPath = normalizeNotebookPath(notebookPath);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), 'VALIDATION_ERROR');
  }

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
