/**
 * session_create ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";
import { kernelToSessionInfo } from "../utils/session-formatter.js";
import { validateStringParameter } from "../utils/validation.js";

interface SessionCreateArgs {
  name?: string;
  notebook_path?: string;
}

/**
 * 新しいセッション（カーネル）を作成する
 */
export async function executeSessionCreate(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const { name = "python3", notebook_path } = args as SessionCreateArgs;

  // 入力検証: name パラメータ
  const nameValidation = validateStringParameter(name, "name", {
    required: false,
    maxLength: 100,
    allowEmpty: false,
  });

  if (!nameValidation.isValid) {
    return createErrorResponse(
      nameValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 入力検証: notebook_path パラメータ
  if (notebook_path !== undefined) {
    const pathValidation = validateStringParameter(
      notebook_path,
      "notebook_path",
      {
        required: false,
        maxLength: 500,
        allowEmpty: false,
      }
    );

    if (!pathValidation.isValid) {
      return createErrorResponse(
        pathValidation.errorMessage!,
        "VALIDATION_ERROR"
      );
    }

    // notebook_path パラメータの警告（タスク 3.6 で実装予定）
    console.warn(
      `[session_create] notebook_path パラメータは現在未実装です（タスク 3.6 で対応予定）: ${notebook_path}`
    );
  }

  try {
    // カーネルを作成
    const kernel = await jupyterClient.createKernel(name);

    // セッション形式に変換（kernel_name は不要なので false を指定）
    const sessionInfo = kernelToSessionInfo(kernel, false);

    return createSuccessResponse({ ...sessionInfo });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
