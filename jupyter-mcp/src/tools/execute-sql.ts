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
  type McpToolResult,
} from '../utils/response-formatter.js';
import type { JupyterToolEntry } from './types.js';
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

    const { success: _success, ...resultData } = result;

    return createSuccessResponse({
      ...resultData,
      query_file_path: queryFilePath,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: false,
  definition: {
    name: 'execute_sql',
    description: `Executes a SQL query and saves results as CSV in the workspace's data/ directory. Queries are auto-saved as .sql files in data/queries/.\n\n[REQUIRED] Before writing SQL:\n(1) Call get_table_detail to inspect table structure. Use key_type/domain in the response to identify JOIN keys\n(2) Call get_logic_index to check for reusable existing logic (SQL templates, etc.)\n\nJOIN rule: JOIN columns that share the same key_type. domain.master_table/master_column indicates FK references.\n\nResponse (SELECT):\n{\n  "file_path": "CSV path (loadable via pd.read_csv)",\n  "row_count": "number of rows",\n  "columns": "array of column names",\n  "truncated": "whether max_rows truncation occurred",\n  "query_file_path": "path to saved SQL file"\n}`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        sql: {
          type: 'string',
          description:
            'SQL query. Dangerous operations (DELETE, ALTER, GRANT, REVOKE, VACUUM, ANALYZE, non-TEMP CREATE TABLE, CREATE/DROP INDEX) are rejected',
        },
        filename: {
          type: 'string',
          description: "Output filename in data/ directory (e.g., 'transactions.csv')",
        },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 300)' },
        max_rows: { type: 'number', description: 'Maximum rows to retrieve (default: 100000)' },
      },
      required: ['session_id', 'sql', 'filename'],
    },
  },
  execute: executeExecuteSql,
};
