/**
 * get_variables ツール実装
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

interface GetVariablesArgs {
  session_id: string;
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
    // （後続の getVariables でエラーになる）
    return sessionId;
  }
}

/**
 * セッション内の変数一覧を取得する
 */
export async function executeGetVariables(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const { session_id } = args as Partial<GetVariablesArgs>;

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

  try {
    // session_id を kernel_id に解決
    const kernelId = await resolveKernelId(validatedSessionId);

    // 変数一覧を取得
    const variables = await jupyterClient.getVariables(kernelId);

    return createSuccessResponse({
      variables,
    });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
