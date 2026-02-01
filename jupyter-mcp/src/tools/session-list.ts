/**
 * session_list ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";
import { kernelsToSessionList } from "../utils/session-formatter.js";

/**
 * アクティブなセッション一覧を取得する
 */
export async function executeSessionList(
  args: Record<string, unknown>
): Promise<McpResponse> {
  // 入力検証: session_list は引数を受け取らないため、
  // 予期しない引数が渡された場合は警告（セキュリティのベストプラクティス）
  if (Object.keys(args).length > 0) {
    console.warn(
      `[session_list] 予期しない引数が渡されました: ${JSON.stringify(args)}`
    );
  }

  try {
    // カーネル一覧を取得
    const kernels = await jupyterClient.listKernels();

    // セッション形式に変換
    const sessions = kernelsToSessionList(kernels);

    return createSuccessResponse({
      sessions,
    });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
