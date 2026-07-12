/**
 * notebook_execute_cell ツール実装
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
import {
  validateStringParameter,
  validateNumberParameter,
  validateAndNormalizeNotebookPath,
  validateCellIndexParam,
} from '../utils/validation.js';
import { resolveSession } from '../utils/session-resolver.js';
import { jupyterClient } from '../jupyter-client/client.js';
import type { AiEvent, CellOutputData } from '../jupyter-client/types.js';

/**
 * AI同期イベントを配信する（失敗しても続行する fire-and-forget）
 */
async function postAiEventSilently(event: AiEvent): Promise<void> {
  try {
    await jupyterClient.postAiEvent(event);
  } catch {
    // イベント配信失敗は無視して実行を続行
  }
}

/**
 * ノートブックの指定セルを再実行する
 */
export async function executeNotebookExecuteCell(args: Record<string, unknown>): Promise<McpResponse> {
  const pathResult = validateAndNormalizeNotebookPath(args.notebook_path);
  if ('error' in pathResult) {
    return createErrorResponse(pathResult.error, 'VALIDATION_ERROR');
  }
  const validatedPath = pathResult.path;

  // 入力検証: session_id
  const sessionIdValidation = validateStringParameter(args.session_id, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });
  if (!sessionIdValidation.isValid) {
    return createErrorResponse(sessionIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const sessionId = args.session_id as string;

  const cellIndexResult = validateCellIndexParam(args.cell_index);
  if ('error' in cellIndexResult) {
    return createErrorResponse(cellIndexResult.error, 'VALIDATION_ERROR');
  }
  const cellIndex = cellIndexResult.index;

  // 入力検証: timeout
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

    await postAiEventSilently({
      type: 'cell_execute_start',
      notebook_path: validatedPath,
      cell_index: cellIndex,
    });

    // セルを実行
    const result = await jupyterClient.executeCellInNotebook(validatedPath, cellIndex, {
      kernel_id: kernelId,
      timeout,
    });

    await postAiEventSilently({
      type: 'cell_execute_end',
      notebook_path: validatedPath,
      cell_index: cellIndex,
      execution_count: result.execution_count,
      success: true,
    });

    // stdout と stderr を抽出（output_type === 'stream' でナローイング）
    const stdout = result.outputs
      .flatMap((o) => (o.output_type === 'stream' && o.name === 'stdout' ? [o.text] : []))
      .join('');
    const stderr = result.outputs
      .flatMap((o) => (o.output_type === 'stream' && o.name === 'stderr' ? [o.text] : []))
      .join('');

    // エラー出力を抽出（KeyboardInterrupt 等）
    const errorOutput = result.outputs.find(
      (o): o is Extract<CellOutputData, { output_type: 'error' }> => o.output_type === 'error',
    );
    const error = errorOutput
      ? { type: errorOutput.ename, message: errorOutput.evalue, traceback: errorOutput.traceback }
      : undefined;

    return createSuccessResponse({
      cell_index: result.cell_index,
      execution_count: result.execution_count,
      stdout,
      stderr,
      execution_time_ms: result.execution_time_ms,
      ...(error !== undefined ? { error } : {}),
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'notebook_execute_cell',
    description: 'Re-executes an existing cell in a notebook at the specified index using the given session.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: { type: 'string', description: 'Notebook path (e.g., analysis.ipynb)' },
        session_id: { type: 'string', description: 'Session ID' },
        cell_index: { type: 'number', description: 'Cell index to execute (0-indexed)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 300)' },
      },
      required: ['notebook_path', 'session_id', 'cell_index'],
    },
  },
  execute: executeNotebookExecuteCell,
};
