/**
 * notebook_clear_outputs ツール実装
 */

import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateAndNormalizeNotebookPath, validateCellIndexParam } from '../utils/validation.js';
import { jupyterClient } from '../jupyter-client/client.js';

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

      await jupyterClient.operateCell(validatedPath, {
        action: 'clear_output',
        index: cellIndex,
      });

      await jupyterClient.postAiEvent({
        type: 'output_cleared',
        notebook_path: validatedPath,
        cell_index: cellIndex,
      });

      return createSuccessResponse({
        notebook_path: validatedPath,
        cell_index: cellIndex,
        message: `ノートブック "${validatedPath}" のセル ${cellIndex} の出力をクリアしました`,
      });
    }
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
