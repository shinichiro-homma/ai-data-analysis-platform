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

  // notebook_path パラメータの警告（タスク 3.6 で実装予定）
  if (notebook_path) {
    console.warn(
      `[session_create] notebook_path パラメータは現在未実装です（タスク 3.6 で対応予定）: ${notebook_path}`
    );
  }

  try {
    // カーネルを作成
    const kernel = await jupyterClient.createKernel(name);

    return createSuccessResponse({
      session_id: kernel.id,
      kernel_id: kernel.id,
      status: kernel.status,
      created_at: kernel.started_at,
    });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
