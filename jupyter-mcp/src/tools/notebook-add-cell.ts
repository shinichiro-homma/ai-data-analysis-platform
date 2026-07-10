/**
 * notebook_add_cell ツール実装
 */

import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import { validateStringParameter, validateAndNormalizeNotebookPath } from '../utils/validation.js';
import { getEffectiveCellCount } from '../utils/notebook-cell-tracker.js';
import { addCellWithSync } from '../utils/cell-operations.js';

/**
 * ノートブックにセルを追加する
 */
export async function executeNotebookAddCell(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }

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

  const validatedPath = pathResult.path;

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

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'notebook_add_cell',
    description: 'Adds a cell (code or markdown) to the notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_type: { type: 'string', enum: ['code', 'markdown'], description: 'Cell type (code or markdown)' },
        source: { type: 'string', description: 'Cell content' },
        position: { type: 'number', description: 'Insert position (0-indexed, appends to end if omitted)' },
      },
      required: ['notebook_path', 'cell_type', 'source'],
    },
  },
  execute: executeNotebookAddCell,
};
