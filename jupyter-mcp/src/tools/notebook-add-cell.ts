/**
 * notebook_add_cell ツール実装
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
import { getEffectiveCellCount } from '../utils/notebook-cell-tracker.js';
import { addCellWithSync } from '../utils/cell-operations.js';

/**
 * ノートブックにセルを追加する
 */
export async function executeNotebookAddCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  // 入力検証: cell_type
  const cellType = args.cell_type as string | undefined;
  if (!cellType || (cellType !== 'code' && cellType !== 'markdown')) {
    return createErrorResponse(
      "cell_type パラメータは必須で、'code' または 'markdown' である必要があります",
      'VALIDATION_ERROR',
    );
  }

  // 入力検証: source
  const sourceValidation = validateStringParameter(args.source, 'source', {
    required: true,
    maxLength: 1000000,
    allowEmpty: false,
  });
  if (!sourceValidation.isValid) {
    return createErrorResponse(sourceValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const source = args.source as string;

  // 入力検証: position
  const position = args.position as number | undefined;
  if (position !== undefined) {
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
      return createErrorResponse('position パラメータは 0 以上の整数である必要があります', 'VALIDATION_ERROR');
    }
  }

  // パストラバーサル攻撃対策（正規化済みパスを以降で使用）
  let validatedPath: string;
  try {
    validatedPath = normalizeNotebookPath(notebookPath);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), 'VALIDATION_ERROR');
  }

  try {
    // 有効セル数を取得（ディスクとメモリの大きい方）
    const effectiveCellCount = await getEffectiveCellCount(validatedPath);

    // 挿入先インデックスを計算
    const cellIndex = position !== undefined ? Math.min(position, effectiveCellCount) : effectiveCellCount;

    // セル追加（AI同期イベント + REST APIフォールバック + トラッカー更新）
    await addCellWithSync(validatedPath, cellType, source, cellIndex, effectiveCellCount, position);

    const positionMessage = position !== undefined ? `位置 ${position} に` : '末尾に';

    return createSuccessResponse({
      notebook_path: validatedPath,
      cell_type: cellType,
      position: position,
      cell_index: cellIndex,
      message: `ノートブック "${validatedPath}" の${positionMessage}${cellType} セルを追加しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
