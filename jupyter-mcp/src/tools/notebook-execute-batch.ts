/**
 * notebook_execute_batch ツール実装
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
import {
  validateStringParameter,
  validateNumberParameter,
  validateCellIndexParam,
  validateAndNormalizeNotebookPath,
} from '../utils/validation.js';
import { resolveSession } from '../utils/session-resolver.js';
import { jupyterClient } from '../jupyter-client/client.js';

const VALID_MODES = ['all', 'up_to', 'from'] as const;
type BatchMode = (typeof VALID_MODES)[number];

/**
 * ノートブックの複数セルを一括実行する
 */
export async function executeNotebookExecuteBatch(args: Record<string, unknown>): Promise<McpResponse> {
  // notebook_path バリデーション
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  // session_id バリデーション
  const sessionIdValidation = validateStringParameter(args.session_id, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });
  if (!sessionIdValidation.isValid) {
    return createErrorResponse(sessionIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const sessionId = args.session_id as string;

  // mode バリデーション
  const modeValidation = validateStringParameter(args.mode, 'mode', {
    required: true,
    maxLength: 10,
    allowEmpty: false,
  });
  if (!modeValidation.isValid) {
    return createErrorResponse(modeValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const mode = args.mode as string;
  if (!VALID_MODES.includes(mode as BatchMode)) {
    return createErrorResponse(`mode must be one of: ${VALID_MODES.join(', ')}. Got: ${mode}`, 'VALIDATION_ERROR');
  }
  const validatedMode = mode as BatchMode;

  // cell_index バリデーション（up_to / from の場合に必須）
  let cellIndex: number | undefined;
  if (validatedMode === 'up_to' || validatedMode === 'from') {
    if (args.cell_index === undefined || args.cell_index === null) {
      return createErrorResponse(`cell_index is required when mode is '${validatedMode}'`, 'VALIDATION_ERROR');
    }
    const cellIndexResult = validateCellIndexParam(args.cell_index);
    if ('error' in cellIndexResult) {
      return createErrorResponse(cellIndexResult.error, 'VALIDATION_ERROR');
    }
    cellIndex = cellIndexResult.index;
  }

  // timeout バリデーション（オプション）
  const timeoutValidation = validateNumberParameter(args.timeout, 'timeout', {
    min: 0,
    max: 300,
  });
  if (!timeoutValidation.isValid) {
    return createErrorResponse(timeoutValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const timeout = typeof args.timeout === 'number' ? args.timeout : 30;

  try {
    // session_id から kernel_id を解決
    const { kernelId } = await resolveSession(sessionId);

    // 一括実行
    const result = await jupyterClient.executeBatchCells(validatedPath, {
      kernel_id: kernelId,
      mode: validatedMode,
      ...(cellIndex !== undefined ? { cell_index: cellIndex } : {}),
      timeout,
    });

    return createSuccessResponse({
      executed_cells: result.executed_cells,
      success_count: result.success_count,
      failed_cell: result.failed_cell,
      ...(result.error != null ? { error: result.error } : {}),
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'notebook_execute_batch',
    description:
      'Executes multiple cells in a notebook at once. Supports three modes: all (execute all cells), up_to (execute from the first cell to the specified index inclusive), from (execute from the specified index to the last cell inclusive). Markdown cells are skipped. Stops on the first error and returns the failed cell index.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        session_id: { type: 'string', description: 'Session ID' },
        mode: {
          type: 'string',
          enum: ['all', 'up_to', 'from'],
          description:
            'Execution mode: all = all cells, up_to = first cell to cell_index (inclusive), from = cell_index to last cell (inclusive)',
        },
        cell_index: {
          type: 'number',
          description: 'Reference cell index (0-indexed). Required when mode is up_to or from',
        },
        timeout: { type: 'number', description: 'Timeout in seconds per cell (default: 30, max: 300)' },
      },
      required: ['notebook_path', 'session_id', 'mode'],
    },
  },
  execute: executeNotebookExecuteBatch,
};
