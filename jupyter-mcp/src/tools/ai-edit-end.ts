/**
 * ai_edit_end ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateAndResolveNotebookPath } from '../utils/ai-edit-helpers.js';

interface AiEditEndArgs {
  session_id?: string;
}

/**
 * AI編集モードを終了する（ノートブックのロックを解除）
 */
export async function executeAiEditEnd(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id } = args as AiEditEndArgs;

  try {
    // session_id を検証し、notebook_path を解決
    const result = await validateAndResolveNotebookPath(session_id);
    if (!result.success) {
      return result.error;
    }

    const { notebookPath } = result;

    // AI編集終了イベントを配信（fire-and-forget）
    await jupyterClient.postAiEvent({
      type: 'ai_edit_end',
      notebook_path: notebookPath,
    });

    return createSuccessResponse({
      locked: false,
      notebook_path: notebookPath,
      message: `ノートブック "${notebookPath}" のロックを解除しました。AI編集モードが終了しました。`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
