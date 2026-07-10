/**
 * notebook_copy_cell ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * セルを指定位置にコピー（複製）する
 */
export async function executeNotebookCopyCell(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  const sourceIndexResult = validateCellIndexParam(args.source_index, 'source_index');
  if ('error' in sourceIndexResult) {
    return createErrorResponse(sourceIndexResult.error, 'VALIDATION_ERROR');
  }
  const sourceIndex = sourceIndexResult.index;

  // target_index はオプショナル。省略時は source_index + 1
  let targetIndex: number;
  if (args.target_index === undefined || args.target_index === null) {
    targetIndex = sourceIndex + 1;
  } else {
    const targetIndexResult = validateCellIndexParam(args.target_index, 'target_index');
    if ('error' in targetIndexResult) {
      return createErrorResponse(targetIndexResult.error, 'VALIDATION_ERROR');
    }
    targetIndex = targetIndexResult.index;
  }

  return operateCellWithSync(
    validatedPath,
    { action: 'copy', index: sourceIndex, to_index: targetIndex },
    { type: 'cell_copied', notebook_path: validatedPath, source_index: sourceIndex, target_index: targetIndex },
    {
      notebook_path: validatedPath,
      source_index: sourceIndex,
      target_index: targetIndex,
      message: `ノートブック "${validatedPath}" のセル ${sourceIndex} を位置 ${targetIndex} にコピーしました`,
    },
  );
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_copy_cell',
    description:
      'Copies a cell to a specified position within a notebook. The copied cell has its outputs and execution_count cleared (for code cells). If target_index is omitted, the cell is copied immediately after the source cell.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        source_index: { type: 'number', description: 'Cell index to copy (0-indexed)' },
        target_index: {
          type: 'number',
          description:
            'Position to insert the copied cell (0-indexed). If omitted, the cell is inserted immediately after the source cell',
        },
      },
      required: ['notebook_path', 'source_index'],
    },
  },
  execute: executeNotebookCopyCell,
};
