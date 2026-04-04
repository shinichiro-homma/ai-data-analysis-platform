/**
 * AI編集モード関連のヘルパー関数
 */

import { validateStringParameter } from './validation.js';
import { resolveNotebookPath } from './session-resolver.js';
import { createErrorResponse, type McpResponse } from './response-formatter.js';

/**
 * session_id を検証し、notebook_path を解決する
 */
export async function validateAndResolveNotebookPath(
  sessionId: unknown,
): Promise<{ success: true; notebookPath: string } | { success: false; error: McpResponse }> {
  // 入力検証: session_id パラメータ（必須）
  const validation = validateStringParameter(sessionId, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });

  if (!validation.isValid) {
    return {
      success: false,
      error: createErrorResponse(validation.errorMessage!, 'VALIDATION_ERROR'),
    };
  }

  // session_id から notebook_path を解決
  const notebookPath = await resolveNotebookPath(sessionId as string);

  if (!notebookPath) {
    return {
      success: false,
      error: createErrorResponse(
        `セッション "${sessionId}" に関連付けられたノートブックが見つかりません。notebook_path 付きで作成されたセッションを指定してください。`,
        'SESSION_NOT_FOUND',
      ),
    };
  }

  return { success: true, notebookPath };
}
