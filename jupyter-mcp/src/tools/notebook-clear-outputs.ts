/**
 * notebook_clear_outputs ツール実装
 */

import type { JupyterToolEntry } from './types.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';
import { operateCellWithSync } from '../utils/cell-operations.js';

/**
 * セルの出力をクリアする（単一セルまたは全セル）
 */
export async function executeNotebookClearOutputs(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  try {
    if (args.cell_index === undefined || args.cell_index === null) {
      // 全セルクリア
      const result = await jupyterClient.clearAllOutputs(validatedPath);

      await jupyterClient.postAiEvent({
        type: 'all_outputs_cleared',
        notebook_path: validatedPath,
      });

      return createSuccessResponse({
        notebook_path: validatedPath,
        cleared_cells: result.cleared_cells,
        message: `ノートブック "${validatedPath}" の全セル出力をクリアしました（${result.cleared_cells} セル）`,
      });
    } else {
      // 単一セルクリア
      const cellIndexResult = validateCellIndexParam(args.cell_index, 'cell_index');
      if ('error' in cellIndexResult) {
        return createErrorResponse(cellIndexResult.error, 'VALIDATION_ERROR');
      }
      const cellIndex = cellIndexResult.index;

      return operateCellWithSync(
        validatedPath,
        { action: 'clear_output', index: cellIndex },
        { type: 'output_cleared', notebook_path: validatedPath, cell_index: cellIndex },
        {
          notebook_path: validatedPath,
          cell_index: cellIndex,
          message: `ノートブック "${validatedPath}" のセル ${cellIndex} の出力をクリアしました`,
        },
      );
    }
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_clear_outputs',
    description:
      'Clears the outputs and execution_count of cells in a notebook. When cell_index is specified, only that cell is cleared. When omitted, all code cells in the notebook are cleared.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        cell_index: {
          type: 'integer',
          description: 'Cell index to clear (0-indexed). If omitted, all code cells are cleared',
        },
      },
      required: ['notebook_path'],
    },
  },
  execute: executeNotebookClearOutputs,
};
