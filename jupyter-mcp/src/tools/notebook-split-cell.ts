/**
 * notebook_split_cell ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import {
  validateAndNormalizeNotebookPath,
  validateCellIndexParam,
  validatePositiveIntegerParam,
} from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

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

  return operateCellWithSync(
    validatedPath,
    { action: 'split', index: cellIndex, split_line: splitLine },
    { type: 'cell_split', notebook_path: validatedPath, cell_index: cellIndex, split_line: splitLine },
    {
      notebook_path: validatedPath,
      cell_index: cellIndex,
      split_line: splitLine,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を行 ${splitLine} で分割しました`,
    },
  );
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_split_cell',
    description:
      'Splits a single cell in a notebook into two cells at the specified line. Lines before split_line go to the first cell, lines from split_line onward go to the second cell.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: { type: 'number', description: 'Cell index to split (0-indexed)' },
        split_line: {
          type: 'number',
          description:
            'Line number at which to split (1-indexed: line 1 means first line goes to first cell, remainder to second cell). Must be between 1 and total_lines-1',
        },
      },
      required: ['notebook_path', 'cell_index', 'split_line'],
    },
  },
  execute: executeNotebookSplitCell,
};
