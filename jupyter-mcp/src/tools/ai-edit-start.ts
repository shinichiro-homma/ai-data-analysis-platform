/**
 * ai_edit_start ツール実装
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

interface AiEditStartArgs {
  session_id?: string;
}

/**
 * AI編集モードを開始する（ノートブックをロック）
 */
export async function executeAiEditStart(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id } = args as AiEditStartArgs;

  try {
    // session_id を検証し、notebook_path を解決
    const result = await validateAndResolveNotebookPath(session_id);
    if (!result.success) {
      return result.error;
    }

    const { notebookPath } = result;

    // AI編集開始イベントを配信（fire-and-forget）
    await jupyterClient.postAiEvent({
      type: 'ai_edit_start',
      notebook_path: notebookPath,
    });

    return createSuccessResponse({
      locked: true,
      notebook_path: notebookPath,
      message: `ノートブック "${notebookPath}" をロックしました。AI編集モードが開始されました。`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
