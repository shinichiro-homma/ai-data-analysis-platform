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

/**
 * アクティブなセッション一覧を取得する
 */
export async function executeSessionList(
  args: Record<string, unknown>
): Promise<McpResponse> {
  try {
    // カーネル一覧を取得
    const kernels = await jupyterClient.listKernels();

    // レスポンスフォーマットに変換
    const sessions = kernels.map((kernel) => ({
      session_id: kernel.id,
      kernel_id: kernel.id,
      status: kernel.status,
      kernel_name: kernel.name,
      created_at: kernel.started_at,
    }));

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
