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

  }

  try {
    if (notebook_path !== undefined && notebook_path !== '') {
      // notebook_path が指定された場合: セッション（ノートブック+カーネル）を作成
      const session = await jupyterClient.createSession(notebook_path, name);

      return createSuccessResponse({
        session_id: session.id,
        kernel_id: session.kernel.id,
        notebook_path: session.path,
        status: session.kernel.execution_state,
        created_at: session.kernel.last_activity,
      });
    } else {
      // notebook_path が指定されない場合: カーネルのみ作成（既存動作）
      const kernel = await jupyterClient.createKernel(name);

      // セッション形式に変換（kernel_name は不要なので false を指定）
      const sessionInfo = kernelToSessionInfo(kernel, false);

      return createSuccessResponse({ ...sessionInfo });
    }
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
