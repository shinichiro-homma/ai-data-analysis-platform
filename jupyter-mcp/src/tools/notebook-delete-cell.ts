/**
 * notebook_delete_cell ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * ノートブックのセルを削除する
 */
export async function executeNotebookDeleteCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  return operateCellWithSync(
    validatedPath,
    { action: 'delete', index: cellIndex },
    { type: 'cell_deleted', notebook_path: validatedPath, cell_index: cellIndex },
    {
      notebook_path: validatedPath,
      cell_index: cellIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を削除しました`,
    },
  );
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_delete_cell',
    description: 'Deletes a cell from a notebook at the specified index.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: { type: 'number', description: 'Cell index to delete (0-indexed)' },
      },
      required: ['notebook_path', 'cell_index'],
    },
  },
  execute: executeNotebookDeleteCell,
};
