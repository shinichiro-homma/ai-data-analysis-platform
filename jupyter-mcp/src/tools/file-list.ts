/**
 * file_list ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";
import { validateStringParameter } from "../utils/validation.js";
import { normalizePath } from "../utils/path-validator.js";
import { ValidationError } from "../utils/errors.js";

/**
 * ワークスペース内のファイル一覧を取得する
 */
export async function executeFileList(
  args: Record<string, unknown>
): Promise<McpResponse> {
  // session_id の検証
  // 注意: 現時点では session_id は使用していないが、将来的な権限管理のために
  // 引数として受け取り、検証を行う
  const sessionIdValidation = validateStringParameter(args.session_id, "session_id", {
    required: true,
    maxLength: 100,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(
      sessionIdValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 型キャスト（検証済み）
  const path = (args.path as string | undefined) ?? "/";

  // path の基本検証（型と長さ）
  if (path !== undefined && path !== null) {
    const pathValidation = validateStringParameter(path, "path", {
      required: false,
      allowEmpty: true, // "/" のみの場合も許可
      maxLength: 500,
    });

    if (!pathValidation.isValid) {
      return createErrorResponse(
        pathValidation.errorMessage!,
        "VALIDATION_ERROR"
      );
    }
  }

  try {
    // パスを正規化（セキュリティチェック含む）
    const normalizedPath = normalizePath(path, {
      allowRoot: true,  // ルートディレクトリ（"/" または空文字）を許可
      allowEmpty: true,
    });

    // ファイル一覧を取得
    const contents = await jupyterClient.listContents(normalizedPath);

    return createSuccessResponse({
      path: normalizedPath,
      contents: contents.contents,
    });
  } catch (error) {
    // ValidationError の場合（パストラバーサル等）
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.code);
    }

    // その他のエラー
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
