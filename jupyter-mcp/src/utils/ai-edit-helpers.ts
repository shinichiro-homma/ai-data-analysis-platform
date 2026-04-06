/**
 * AI編集モード関連のヘルパー関数
 */

import { jupyterClient } from '../jupyter-client/client.js';
import { validateStringParameter } from './validation.js';
import { resolveNotebookPath } from './session-resolver.js';
import { createErrorResponse, type McpResponse } from './response-formatter.js';
import { logger } from './logger.js';

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

/**
 * args から notebook_path を解決する（session_id 経由）
 * バリデーション不要の fire-and-forget 用途向け軽量版。
 * バリデーション付きは validateAndResolveNotebookPath を使うこと。
 */
async function resolveNotebookPathFromArgs(args: Record<string, unknown>): Promise<string | null> {
  // notebook_path が直接指定されている場合はそのまま使う
  const notebookPath = args.notebook_path;
  if (typeof notebookPath === 'string' && notebookPath.length > 0) {
    return notebookPath;
  }
  // session_id から解決
  const sessionId = args.session_id;
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    return resolveNotebookPath(sessionId);
  }
  return null;
}

type AiEditEventType = 'ai_edit_start' | 'ai_edit_end';

/**
 * AI編集イベントを配信する（ミドルウェアから呼び出し）
 * fire-and-forget: 失敗してもツール実行には影響しない
 */
async function emitAiEditEvent(type: AiEditEventType, args: Record<string, unknown>): Promise<void> {
  try {
    const notebookPath = await resolveNotebookPathFromArgs(args);
    if (!notebookPath) return;
    await jupyterClient.postAiEvent({ type, notebook_path: notebookPath });
  } catch (error) {
    logger.warn(`[emitAiEditEvent:${type}] Failed to emit event:`, error);
  }
}

export const emitAiEditStart = (args: Record<string, unknown>): Promise<void> => emitAiEditEvent('ai_edit_start', args);

export const emitAiEditEnd = (args: Record<string, unknown>): Promise<void> => emitAiEditEvent('ai_edit_end', args);
