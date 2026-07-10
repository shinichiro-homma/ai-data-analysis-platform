/**
 * notebook_list_cells ツール実装
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
import { validateAndNormalizeNotebookPath } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックのセル一覧を取得する
 */
export async function executeNotebookListCells(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

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

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'notebook_list_cells',
    description: 'Retrieves the list of cells in a notebook with their index, type, source, and outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
      },
      required: ['notebook_path'],
    },
  },
  execute: executeNotebookListCells,
};
