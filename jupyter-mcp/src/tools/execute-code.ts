/**
 * execute_code ツール実装
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
import { resolveKernelId } from "../utils/session-resolver.js";

interface ExecuteCodeArgs {
  session_id: string;
  code: string;
  timeout?: number;
}

/**
 * Python コードを実行する
 */
export async function executeExecuteCode(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const { session_id, code = "", timeout = 30 } = args as Partial<ExecuteCodeArgs>;

  // 入力検証: session_id
  const sessionIdValidation = validateStringParameter(session_id, "session_id", {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(
      sessionIdValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 検証後、session_id は必ず string
  const validatedSessionId = session_id as string;

  // 入力検証: code
  const codeValidation = validateStringParameter(code, "code", {
    required: false,
    allowEmpty: true,
    maxLength: 1000000,
    allowNull: false,
  });

  if (!codeValidation.isValid) {
    return createErrorResponse(
      codeValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 入力検証: timeout
  if (timeout !== undefined) {
    if (typeof timeout !== "number") {
      return createErrorResponse(
        "timeout パラメータは数値である必要があります",
        "VALIDATION_ERROR"
      );
    }

    if (timeout <= 0) {
      return createErrorResponse(
        "timeout は正の数である必要があります",
        "VALIDATION_ERROR"
      );
    }

    if (timeout > 300) {
      return createErrorResponse(
        "timeout は最大 300 秒です",
        "VALIDATION_ERROR"
      );
    }
  }

  try {
    // session_id を kernel_id に解決
    const kernelId = await resolveKernelId(validatedSessionId);

    // コード実行
    const result = await jupyterClient.executeCode(kernelId, {
      code,
      timeout,
    });

    // 成功時のレスポンス
    if (result.success) {
      // stdout と stderr を結合
      const stdout = result.outputs
        .filter((o) => o.type === "stdout")
        .map((o) => o.text)
        .join("");
      const stderr = result.outputs
        .filter((o) => o.type === "stderr")
        .map((o) => o.text)
        .join("");

      return createSuccessResponse({
        stdout,
        stderr,
        result: result.result,
        images: result.images,
        execution_time_ms: result.execution_time_ms,
      });
    }

    // エラー時のレスポンス
    if (result.error) {
      return createErrorResponse(
        result.error.message,
        result.error.type || "EXECUTION_ERROR"
      );
    }

    // エラーだが error フィールドがない場合
    return createErrorResponse(
      "コード実行に失敗しました",
      "EXECUTION_ERROR"
    );
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
