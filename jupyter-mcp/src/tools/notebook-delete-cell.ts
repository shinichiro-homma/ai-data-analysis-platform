/**
 * notebook_delete_cell ツール実装
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
 * ノートブックのセルを削除する
 */
export async function executeNotebookDeleteCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  // 入力検証: cell_index
  const cellIndexValidation = validateCellIndex(args.cell_index);
  if (!cellIndexValidation.isValid) {
    return createErrorResponse(cellIndexValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const cellIndex = args.cell_index as number;

  // パストラバーサル攻撃対策（正規化済みパスを以降で使用）
  let validatedPath: string;
  try {
    validatedPath = normalizeNotebookPath(notebookPath);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), 'VALIDATION_ERROR');
  }

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
