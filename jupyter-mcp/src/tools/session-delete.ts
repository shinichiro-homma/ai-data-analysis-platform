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
  if (!session_id) {
    return createErrorResponse(
      "session_id パラメータは必須です",
      "VALIDATION_ERROR"
    );
  }

  if (typeof session_id !== "string") {
    return createErrorResponse(
      "session_id パラメータは文字列である必要があります",
      "VALIDATION_ERROR"
    );
  }

  // 空文字列チェック
  if (session_id.trim() === "") {
    return createErrorResponse(
      "session_id パラメータが空です",
      "VALIDATION_ERROR"
    );
  }

  // 長さチェック（DoS対策）
  if (session_id.length > 100) {
    return createErrorResponse(
      "session_id が長すぎます（最大100文字）",
      "VALIDATION_ERROR"
    );
  }

  // NULL バイト攻撃対策
  if (session_id.includes("\0")) {
    return createErrorResponse(
      "session_id に不正な文字が含まれています",
      "VALIDATION_ERROR"
    );
  }

  try {
    // カーネルを削除
    const result = await jupyterClient.deleteKernel(session_id);

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
