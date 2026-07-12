/**
 * notebook_change_cell_type ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

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

  return operateCellWithSync(
    validatedPath,
    { action: 'change_type', index: cellIndex, cell_type: newType },
    {
      notebook_path: validatedPath,
      cell_index: cellIndex,
      new_type: newType,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} のタイプを "${newType}" に変更しました`,
    },
  );
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_change_cell_type',
    description:
      'Changes the type of a cell in a notebook (code ↔ markdown). outputs and execution_count are always cleared/initialized on type change.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: { type: 'number', description: 'Cell index to change type (0-indexed)' },
        new_type: {
          type: 'string',
          enum: ['code', 'markdown'],
          description: 'New cell type (code or markdown)',
        },
      },
      required: ['notebook_path', 'cell_index', 'new_type'],
    },
  },
  execute: executeNotebookChangeCellType,
};
