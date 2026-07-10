/**
 * kernel_restart ツール実装
 */

import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
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

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'kernel_restart',
    description:
      'Restarts the kernel associated with the given session. All variables and state are cleared. To re-execute all cells after restart, call notebook_execute_batch(mode: "all") afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
      },
      required: ['session_id'],
    },
  },
  execute: executeKernelRestart,
};
