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
import { resolveKernelId } from "../utils/session-resolver.js";

interface GetVariablesArgs {
  session_id: string;
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
