/**
 * file_list ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter, validateWorkspaceId } from '../utils/validation.js';
import { normalizePath } from '../utils/path-validator.js';
import { ValidationError } from '../utils/errors.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * ワークスペース内のファイル一覧を取得する
 */
export async function executeFileList(args: Record<string, unknown>): Promise<McpResponse> {
  // workspace_id の検証（必須、パストラバーサル防止含む）
  const workspaceIdValidation = validateWorkspaceId(args.workspace_id);
  if (!workspaceIdValidation.isValid) {
    return createErrorResponse(workspaceIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  const workspace_id = args.workspace_id as string;

  // path の基本検証（型と長さ）
  const subPath = (args.path as string | undefined) ?? '';
  if (args.path !== undefined && args.path !== null) {
    const pathValidation = validateStringParameter(subPath, 'path', {
      required: false,
      allowEmpty: true,
      maxLength: 500,
    });

    if (!pathValidation.isValid) {
      return createErrorResponse(pathValidation.errorMessage!, 'VALIDATION_ERROR');
    }
  }

  try {
    // ワークスペースのContents APIパスを解決
    const wsPath = await resolveWorkspacePath(workspace_id);

    // ワークスペースパスプレフィックスを付加
    let workspacePath: string;
    if (!subPath || subPath === '/' || subPath === '') {
      workspacePath = wsPath;
    } else {
      // サブパスを正規化（セキュリティチェック含む）
      const normalizedSubPath = normalizePath(subPath, {
        allowRoot: true,
        allowEmpty: true,
      });
      workspacePath = normalizedSubPath === '/' ? wsPath : `${wsPath}/${normalizedSubPath}`;
    }

    // ファイル一覧を取得
    const contents = await jupyterClient.listContents(workspacePath);

    // レスポンスのパスからワークスペースプレフィックスを除去
    let displayPath: string;
    const rawPath = contents.path;
    if (rawPath === '/' + wsPath) {
      displayPath = '/';
    } else if (rawPath.startsWith('/' + wsPath + '/')) {
      displayPath = '/' + rawPath.slice(('/' + wsPath + '/').length);
    } else {
      displayPath = rawPath;
    }

    return createSuccessResponse({
      path: displayPath,
      contents: contents.contents,
    });
  } catch (error) {
    // ValidationError の場合（パストラバーサル等）
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.code);
    }

    // その他のエラー
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
