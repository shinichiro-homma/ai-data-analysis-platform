/**
 * export_sql ツール実装
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
import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { validateNumberParameter, validateFilename, validateSqlToolCommonParams } from '../utils/validation.js';
import { resolveWorkspaceIdOrError } from '../utils/session-resolver.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';
import { saveQueryFile } from '../utils/query-file.js';

interface ExportSqlArgs {
  session_id: string;
  sql: string;
  filename: string;
  format?: string;
  timeout?: number;
}

/**
 * SQLクエリを実行し、結果をワークスペースの data/ に Parquet/CSV としてエクスポートする
 */
export async function executeExportSql(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id, sql, filename: rawFilename, format, timeout } = args as Partial<ExportSqlArgs>;

  // 入力検証: session_id, sql
  const commonError = validateSqlToolCommonParams(session_id, sql);
  if (commonError) {
    return createErrorResponse(commonError, 'VALIDATION_ERROR');
  }

  // data/ プレフィックスの自動除去（AIが "data/filename.parquet" を送信するケースに対応）
  const filename = typeof rawFilename === 'string' ? rawFilename.replace(/^data\//, '') : rawFilename;

  // 入力検証: filename（パストラバーサル防止含む）
  const filenameValidation = validateFilename(filename);
  if (!filenameValidation.isValid) {
    return createErrorResponse(filenameValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 入力検証: format（parquet / csv のみ許可）
  if (format !== undefined) {
    if (format !== 'parquet' && format !== 'csv') {
      return createErrorResponse('format は "parquet" または "csv" のみ指定できます', 'VALIDATION_ERROR');
    }
  }

  // 入力検証: timeout
  const timeoutValidation = validateNumberParameter(timeout, 'timeout', {
    min: 0,
    max: 600,
  });
  if (!timeoutValidation.isValid) {
    return createErrorResponse(timeoutValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  try {
    // session_id からワークスペースIDを解決
    const wsResult = await resolveWorkspaceIdOrError(session_id as string);
    if ('error' in wsResult) {
      return wsResult.error;
    }
    const { workspaceId } = wsResult;

    // SQLエクスポートAPI呼び出し
    const result = await jupyterClient.exportSql({
      sql: sql as string,
      workspace_id: workspaceId,
      file_path: filename as string,
      ...(format !== undefined ? { format: format as 'parquet' | 'csv' } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    });

    // クエリ保存（エクスポート成功時のみ）
    const workspacePath = await resolveWorkspacePath(workspaceId);
    const queryFilePath = await saveQueryFile({
      workspacePath,
      sql: sql as string,
      filename: filename as string,
      rowCount: result.row_count ?? 0,
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

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'export_sql',
    description: `Executes a SQL query and exports results as Parquet/CSV to the workspace's data/ directory. No row limit, streaming processing — ideal for dataset creation. Default format is Parquet; use CSV only when specified.\n\n[REQUIRED] Before writing SQL:\n(1) Call get_table_detail to inspect table structure\n(2) Call get_logic_index to check for reusable existing logic\n\nResponse:\n{\n  "file_path": "export file path (loadable via pd.read_parquet in execute_code)",\n  "row_count": "number of exported rows",\n  "file_size_bytes": "file size"\n}`,
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        sql: {
          type: 'string',
          description: 'SELECT query to export. Dangerous operations (DELETE, ALTER, GRANT, REVOKE, etc.) are rejected',
        },
        filename: {
          type: 'string',
          description: "Output file path in data/ directory (e.g., 'purchase_history.parquet')",
        },
        format: {
          type: 'string',
          enum: ['parquet', 'csv'],
          description: 'Output format (default: parquet). Use csv only when user specifies',
        },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 300, max: 600)' },
      },
      required: ['session_id', 'sql', 'filename'],
    },
  },
  execute: executeExportSql,
};
