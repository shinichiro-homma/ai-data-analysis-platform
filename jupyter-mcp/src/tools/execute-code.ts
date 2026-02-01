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

interface ExecuteCodeArgs {
  session_id: string;
  code: string;
  timeout?: number;
}

/**
 * session_id を kernel_id に解決する
 *
 * session_id として渡される値は2つのパターンがある:
 * 1. notebook_path 付きで作成された場合: session.id（session.kernel.id を取得する必要がある）
 * 2. notebook_path なしで作成された場合: kernel.id そのもの
 *
 * @param sessionId - session_id パラメータ
 * @returns kernel_id
 */
async function resolveKernelId(sessionId: string): Promise<string> {
  try {
    // まず、session として検索
    const sessions = await jupyterClient.listSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      // session として見つかった場合: session.kernel.id を使用
      return session.kernel.id;
    }

    // session として見つからない場合: session_id をそのまま kernel_id として使用
    // （notebook_path なしで作成された場合、kernel.id が返されている）
    return sessionId;
  } catch (error) {
    // listSessions が失敗した場合も、session_id をそのまま返す
    // （後続の executeCode でエラーになる）
    return sessionId;
  }
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

  // 入力検証: code
  // code パラメータはオプション（省略時は空文字列）、空文字列も許可
  if (code === null) {
    return createErrorResponse(
      "code パラメータが不正です",
      "VALIDATION_ERROR"
    );
  }

  if (typeof code !== "string") {
    return createErrorResponse(
      "code パラメータは文字列である必要があります",
      "VALIDATION_ERROR"
    );
  }

  // 長さチェック（DoS対策）
  if (code.length > 1000000) {
    return createErrorResponse(
      "code が長すぎます（最大1000000文字）",
      "VALIDATION_ERROR"
    );
  }

  // NULLバイト攻撃対策
  if (code.includes("\0")) {
    return createErrorResponse(
      "code に不正な文字が含まれています",
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
    // session_id の存在チェック（検証後なので必ず存在するはず）
    if (!session_id || typeof session_id !== 'string') {
      return createErrorResponse(
        "session_id パラメータが不正です",
        "VALIDATION_ERROR"
      );
    }

    // session_id を kernel_id に解決
    const kernelId = await resolveKernelId(session_id);

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
