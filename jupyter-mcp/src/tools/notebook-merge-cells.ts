/**
 * notebook_merge_cells ツール実装
 */

import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { createErrorResponse, type McpResponse, type McpToolResult } from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * 隣接する複数セルを1つに結合する
 */
export async function executeNotebookMergeCells(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  const startIndexResult = validateCellIndexParam(args.start_index, 'start_index');
  if ('error' in startIndexResult) {
    return createErrorResponse(startIndexResult.error, 'VALIDATION_ERROR');
  }
  const startIndex = startIndexResult.index;

  const endIndexResult = validateCellIndexParam(args.end_index, 'end_index');
  if ('error' in endIndexResult) {
    return createErrorResponse(endIndexResult.error, 'VALIDATION_ERROR');
  }
  const endIndex = endIndexResult.index;

  if (endIndex <= startIndex) {
    return createErrorResponse('end_index must be greater than start_index', 'VALIDATION_ERROR');
  }

  return operateCellWithSync(
    validatedPath,
    { action: 'merge', start_index: startIndex, end_index: endIndex },
    { type: 'cells_merged', notebook_path: validatedPath, start_index: startIndex, end_index: endIndex },
    {
      notebook_path: validatedPath,
      start_index: startIndex,
      end_index: endIndex,
      message: `ノートブック "${validatedPath}" のセル ${startIndex}〜${endIndex} を結合しました`,
    },
  );
}

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'notebook_merge_cells',
    description:
      'Merges adjacent cells in a notebook into a single cell. All cells in the range must be the same type (code or markdown). The merged cell source is the concatenation of all sources joined by newlines.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        start_index: { type: 'number', description: 'Start cell index (0-indexed, inclusive)' },
        end_index: {
          type: 'number',
          description: 'End cell index (0-indexed, inclusive). Must be greater than start_index',
        },
      },
      required: ['notebook_path', 'start_index', 'end_index'],
    },
  },
  execute: executeNotebookMergeCells,
};
