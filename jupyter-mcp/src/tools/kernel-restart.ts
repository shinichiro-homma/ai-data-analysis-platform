/**
 * kernel_restart ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateStringParameter } from '../utils/validation.js';
import { resolveKernelId } from '../utils/session-resolver.js';

interface KernelRestartArgs {
  session_id: string;
}

/**
 * カーネルを再起動する
 */
export async function executeKernelRestart(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id } = args as Partial<KernelRestartArgs>;

  // 入力検証: session_id
  const sessionIdValidation = validateStringParameter(session_id, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(sessionIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  const validatedSessionId = session_id as string;

  try {
    // session_id を kernel_id に解決
    const kernelId = await resolveKernelId(validatedSessionId);

    await jupyterClient.restartKernel(kernelId);

    return createSuccessResponse({
      kernel_id: kernelId,
      status: 'restarting',
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
