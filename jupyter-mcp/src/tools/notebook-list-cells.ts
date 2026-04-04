/**
 * notebook_list_cells ツール実装
 */

import { normalizeNotebookPath } from '../utils/path-validator.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックのセル一覧を取得する
 */
export async function executeNotebookListCells(args: Record<string, unknown>): Promise<McpResponse> {
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

  // パストラバーサル攻撃対策（正規化済みパスを以降で使用）
  let validatedPath: string;
  try {
    validatedPath = normalizeNotebookPath(notebookPath);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), 'VALIDATION_ERROR');
  }

  try {
    const notebook = await jupyterClient.getContents(validatedPath);
    const cells = notebook.content.cells.map((cell, index) => {
      const cellInfo: Record<string, unknown> = {
        cell_index: index,
        cell_type: cell.cell_type,
        source: cell.source,
      };
      if (cell.cell_type === 'code') {
        cellInfo.outputs = cell.outputs ?? [];
        cellInfo.execution_count = cell.execution_count ?? null;
      }
      return cellInfo;
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      total_cells: cells.length,
      cells,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
