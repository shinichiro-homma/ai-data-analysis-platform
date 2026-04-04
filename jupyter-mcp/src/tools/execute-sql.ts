/**
 * execute_sql ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateNumberParameter, validateFilename, validateSqlToolCommonParams } from '../utils/validation.js';
import { resolveWorkspaceIdOrError } from '../utils/session-resolver.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';
import { saveQueryFile } from '../utils/query-file.js';

interface ExecuteSqlArgs {
  session_id: string;
  sql: string;
  filename: string;
  timeout?: number;
  max_rows?: number;
}

/**
 * SQLクエリを実行し、結果をワークスペースの data/ にCSVとして保存する
 */
export async function executeExecuteSql(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id, sql, filename, timeout, max_rows } = args as Partial<ExecuteSqlArgs>;

  // 入力検証: session_id, sql
  const commonError = validateSqlToolCommonParams(session_id, sql);
  if (commonError) {
    return createErrorResponse(commonError, 'VALIDATION_ERROR');
  }

  // 入力検証: filename（パストラバーサル防止含む）
  const filenameValidation = validateFilename(filename);
  if (!filenameValidation.isValid) {
    return createErrorResponse(filenameValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 入力検証: timeout
  const timeoutValidation = validateNumberParameter(timeout, 'timeout', {
    min: 0,
    max: 300,
  });
  if (!timeoutValidation.isValid) {
    return createErrorResponse(timeoutValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 入力検証: max_rows
  const maxRowsValidation = validateNumberParameter(max_rows, 'max_rows', {
    min: 0,
    integer: true,
  });
  if (!maxRowsValidation.isValid) {
    return createErrorResponse(maxRowsValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  try {
    // session_id からワークスペースIDを解決
    const wsResult = await resolveWorkspaceIdOrError(session_id as string);
    if ('error' in wsResult) {
      return wsResult.error;
    }
    const { workspaceId } = wsResult;

    // SQL実行API呼び出し
    const result = await jupyterClient.executeSql({
      sql: sql as string,
      workspace_id: workspaceId,
      filename: filename as string,
      ...(timeout !== undefined ? { timeout } : {}),
      ...(max_rows !== undefined ? { max_rows } : {}),
    });

    // クエリ保存（実行成功時のみ）
    const workspacePath = await resolveWorkspacePath(workspaceId);
    const queryFilePath = await saveQueryFile({
      workspacePath,
      sql: sql as string,
      filename: filename as string,
      rowCount: result.row_count ?? result.affected_rows ?? 0,
      executionTimeMs: result.execution_time_ms,
    });

    const { success, ...resultData } = result;

    return createSuccessResponse({
      ...resultData,
      query_file_path: queryFilePath,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
