/**
 * notebook_edit_cell ツール実装
 */

import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import {
  validateStringParameter,
  validateAndNormalizeNotebookPath,
  validateCellIndexParam,
} from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * ノートブックのセルを編集する
 */
export async function executeNotebookEditCell(args: Record<string, unknown>): Promise<McpResponse> {
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

  // 入力検証: source
  const sourceValidation = validateStringParameter(args.source, 'source', {
    required: true,
    maxLength: 1000000,
    allowEmpty: true,
  });
  if (!sourceValidation.isValid) {
    return createErrorResponse(sourceValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const source = args.source as string;

  return operateCellWithSync(
    validatedPath,
    { action: 'update', index: cellIndex, cell: { source } },
    { type: 'cell_edited', notebook_path: validatedPath, cell_index: cellIndex, source },
    {
      notebook_path: validatedPath,
      cell_index: cellIndex,
      message: `ノートブック "${validatedPath}" のセル ${cellIndex} を編集しました`,
    },
  );
}

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'notebook_edit_cell',
    description: 'Edits the source code of an existing cell in a notebook.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: { type: 'number', description: 'Cell index to edit (0-indexed)' },
        source: { type: 'string', description: 'New source code for the cell' },
      },
      required: ['notebook_path', 'cell_index', 'source'],
    },
  },
  execute: executeNotebookEditCell,
};
