/**
 * notebook_execute_cell ツール実装
 */

import { normalizeNotebookPath } from '../utils/path-validator.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter, validateCellIndex, validateNumberParameter } from '../utils/validation.js';
import { resolveSession } from '../utils/session-resolver.js';
import { jupyterClient } from '../jupyter-client/client.js';

/**
 * ノートブックの指定セルを再実行する
 */
export async function executeNotebookExecuteCell(args: Record<string, unknown>): Promise<McpResponse> {
  // 入力検証: notebook_path
  const notebookPathValidation = validateStringParameter(args.notebook_path, 'notebook_path', {
    required: true,
    maxLength: 500,
    allowEmpty: false,
  });
  if (!notebookPathValidation.isValid) {
    return createErrorResponse(notebookPathValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const notebookPath = args.notebook_path as string;

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

  // 入力検証: cell_index
  const cellIndexValidation = validateCellIndex(args.cell_index);
  if (!cellIndexValidation.isValid) {
    return createErrorResponse(cellIndexValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const cellIndex = args.cell_index as number;

  // パストラバーサル攻撃対策（正規化済みパスを以降で使用）
  let validatedPath: string;
  try {
    validatedPath = normalizeNotebookPath(notebookPath);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), 'VALIDATION_ERROR');
  }

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

    // セルを実行
    const result = await jupyterClient.executeCellInNotebook(validatedPath, cellIndex, {
      kernel_id: kernelId,
      timeout,
    });

    // stdout と stderr を抽出（output_type === 'stream' でナローイング）
    const stdout = result.outputs
      .flatMap((o) => (o.output_type === 'stream' && o.name === 'stdout' ? [o.text] : []))
      .join('');
    const stderr = result.outputs
      .flatMap((o) => (o.output_type === 'stream' && o.name === 'stderr' ? [o.text] : []))
      .join('');

    return createSuccessResponse({
      cell_index: result.cell_index,
      execution_count: result.execution_count,
      stdout,
      stderr,
      execution_time_ms: result.execution_time_ms,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
