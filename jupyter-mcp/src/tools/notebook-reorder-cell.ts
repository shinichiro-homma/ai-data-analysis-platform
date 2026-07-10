/**
 * notebook_reorder_cell ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * ノートブックのセルを並び替える
 */
export async function executeNotebookReorderCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  const toIndexResult = validateCellIndexParam(args.to_index, 'to_index');
  if ('error' in toIndexResult) {
    return createErrorResponse(toIndexResult.error, 'VALIDATION_ERROR');
  }
  const toIndex = toIndexResult.index;

  return operateCellWithSync(
    validatedPath,
    { action: 'reorder', index: cellIndex, to_index: toIndex },
    { type: 'cell_reordered', notebook_path: validatedPath, cell_index: cellIndex, to_index: toIndex },
    {
      notebook_path: validatedPath,
      cell_index: cellIndex,
      to_index: toIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} をインデックス ${toIndex} に移動しました`,
    },
  );
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_reorder_cell',
    description: 'Moves a cell from one position to another within a notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: { type: 'number', description: 'Cell index to move (0-indexed, source position)' },
        to_index: { type: 'number', description: 'Target position to move the cell to (0-indexed)' },
      },
      required: ['notebook_path', 'cell_index', 'to_index'],
    },
  },
  execute: executeNotebookReorderCell,
};
