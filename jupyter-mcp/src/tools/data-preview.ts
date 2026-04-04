/**
 * data_preview ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateWorkspaceId } from '../utils/validation.js';
import { normalizePath } from '../utils/path-validator.js';
import { ValidationError } from '../utils/errors.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * ワークスペース内のCSV/Parquetファイルの構造をプレビューする
 */
export async function executeDataPreview(args: Record<string, unknown>): Promise<McpResponse> {
  // workspace_id の検証（必須）
  const workspaceIdValidation = validateWorkspaceId(args.workspace_id);
  if (!workspaceIdValidation.isValid) {
    return createErrorResponse(workspaceIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // file_path の検証（必須）
  if (args.file_path === undefined || args.file_path === null || args.file_path === '') {
    return createErrorResponse('file_path パラメータは必須です', 'VALIDATION_ERROR');
  }
  if (typeof args.file_path !== 'string') {
    return createErrorResponse('file_path パラメータは文字列である必要があります', 'VALIDATION_ERROR');
  }

  const workspace_id = args.workspace_id as string;
  const file_path = args.file_path as string;

  // head_rows のバリデーション（任意、デフォルト5）
  let head_rows = 5;
  if (args.head_rows !== undefined && args.head_rows !== null) {
    if (typeof args.head_rows !== 'number' || !Number.isInteger(args.head_rows) || args.head_rows < 0) {
      return createErrorResponse('head_rows パラメータは 0 以上の整数である必要があります', 'VALIDATION_ERROR');
    }
    if (args.head_rows > 50) {
      return createErrorResponse('head_rows パラメータは 50 以下である必要があります', 'VALIDATION_ERROR');
    }
    head_rows = args.head_rows as number;
  }

  try {
    // パストラバーサル対策
    const normalizedFilePath = normalizePath(file_path);

    // ワークスペースパスを解決
    const wsPath = await resolveWorkspacePath(workspace_id);
    const fullPath = `${wsPath}/${normalizedFilePath}`;

    // データプレビューを取得
    const preview = await jupyterClient.getDataPreview(fullPath, { head_rows });

    return createSuccessResponse({ ...preview });
  } catch (error) {
    // ValidationError の場合（パストラバーサル等）
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.code);
    }

    // その他のエラー
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
