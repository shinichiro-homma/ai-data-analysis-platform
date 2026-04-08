/**
 * notebook_copy_cell ツール実装
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

  try {
    // REST API でセルをコピー
    await jupyterClient.operateCell(validatedPath, {
      action: 'copy',
      index: sourceIndex,
      to_index: targetIndex,
    });

    // AI同期イベントを配信（ブラウザにリアルタイム反映）
    await jupyterClient.postAiEvent({
      type: 'cell_copied',
      notebook_path: validatedPath,
      source_index: sourceIndex,
      target_index: targetIndex,
    });

    return createSuccessResponse({
      notebook_path: validatedPath,
      source_index: sourceIndex,
      target_index: targetIndex,
      message: `ノートブック "${validatedPath}" のセル ${sourceIndex} を位置 ${targetIndex} にコピーしました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
