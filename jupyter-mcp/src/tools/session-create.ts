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
  if (name && typeof name !== "string") {
    return createErrorResponse(
      "name パラメータは文字列である必要があります",
      "VALIDATION_ERROR"
    );
  }

  // 長さチェック（DoS対策）
  if (name && name.length > 100) {
    return createErrorResponse(
      "カーネル名が長すぎます（最大100文字）",
      "VALIDATION_ERROR"
    );
  }

  // NULL バイト攻撃対策
  if (name && name.includes("\0")) {
    return createErrorResponse(
      "カーネル名に不正な文字が含まれています",
      "VALIDATION_ERROR"
    );
  }

  // notebook_path パラメータの検証
  if (notebook_path !== undefined) {
    if (typeof notebook_path !== "string") {
      return createErrorResponse(
        "notebook_path パラメータは文字列である必要があります",
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
