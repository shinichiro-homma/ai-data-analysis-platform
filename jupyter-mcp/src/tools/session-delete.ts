/**
 * session_delete ツール実装
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

interface SessionDeleteArgs {
  session_id?: string;
}

/**
 * 分析セッションを終了し、リソースを解放する
 */
export async function executeSessionDelete(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const { session_id } = args as SessionDeleteArgs;

  // 入力検証: session_id パラメータ（必須）
  const validation = validateStringParameter(session_id, "session_id", {
    required: true,
    maxLength: 100,
    allowEmpty: false,
  });

  if (!validation.isValid) {
    return createErrorResponse(
      validation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  try {
    // カーネルを削除
    // バリデーション成功後は session_id は必ず string
    const result = await jupyterClient.deleteKernel(session_id as string);

    return createSuccessResponse({
      session_id: result.id,
      status: result.status,
    });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
