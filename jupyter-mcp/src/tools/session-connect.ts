/**
 * session_connect ツール実装
 *
 * 既存のセッション（ブラウザで開いているノートブック）に接続する
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { validateStringParameter } from '../utils/validation.js';
import { logger } from '../utils/logger.js';

interface SessionConnectArgs {
  notebook_path?: string;
  kernel_id?: string;
}

/**
 * 既存のセッションに接続する
 * notebook_path または kernel_id のどちらかを指定
 */
export async function executeSessionConnect(args: Record<string, unknown>): Promise<McpResponse> {
  const { notebook_path, kernel_id, ...unexpectedArgs } = args as SessionConnectArgs & Record<string, unknown>;

  // 入力検証: 予期しない引数の警告（セキュリティのベストプラクティス）
  if (Object.keys(unexpectedArgs).length > 0) {
    logger.warn(`[session_connect] 予期しない引数が渡されました: ${JSON.stringify(unexpectedArgs)}`);
  }

  // 入力検証: notebook_path または kernel_id のどちらかが必要
  if (!notebook_path && !kernel_id) {
    return createErrorResponse('notebook_path または kernel_id のどちらかを指定してください', 'VALIDATION_ERROR');
  }

  // notebook_path のバリデーション
  if (notebook_path) {
    const pathValidation = validateStringParameter(notebook_path, 'notebook_path', {
      maxLength: 500,
    });
    if (!pathValidation.isValid) {
      return createErrorResponse(pathValidation.errorMessage!, 'VALIDATION_ERROR');
    }
  }

  // kernel_id のバリデーション
  if (kernel_id) {
    const kernelValidation = validateStringParameter(kernel_id, 'kernel_id', {
      maxLength: 100,
    });
    if (!kernelValidation.isValid) {
      return createErrorResponse(kernelValidation.errorMessage!, 'VALIDATION_ERROR');
    }
  }

  try {
    let session;

    if (notebook_path) {
      // ノートブックパスでセッションを検索
      session = await jupyterClient.getSessionByPath(notebook_path);
      if (!session) {
        return createErrorResponse(
          `指定されたノートブックに関連するセッションが見つかりません: ${notebook_path}`,
          'SESSION_NOT_FOUND',
        );
      }
    } else {
      // カーネルIDでセッションを検索
      session = await jupyterClient.getSessionByKernelId(kernel_id!);
      if (!session) {
        return createErrorResponse(
          `指定されたカーネルに関連するセッションが見つかりません: ${kernel_id}`,
          'SESSION_NOT_FOUND',
        );
      }
    }

    return createSuccessResponse({
      session_id: session.id,
      kernel_id: session.kernel.id,
      notebook_path: session.path,
      status: session.kernel.execution_state,
      connected: true,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'session_connect',
    description:
      'Connects to an existing session. Use to share/reconnect to a kernel the user has open in the browser. Enables reconnection after MCP restart or connecting to user-initiated sessions. Use to reuse existing sessions rather than creating new ones.',
    inputSchema: {
      type: 'object',
      properties: {
        notebook_path: {
          type: 'string',
          description: 'Path of the notebook to connect to (e.g., analysis.ipynb)',
        },
        kernel_id: {
          type: 'string',
          description: 'Kernel ID to connect to. Can be used instead of notebook_path',
        },
      },
      required: [],
    },
  },
  execute: executeSessionConnect,
};
