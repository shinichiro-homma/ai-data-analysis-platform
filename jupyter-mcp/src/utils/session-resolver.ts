/**
 * セッション関連のユーティリティ関数
 */

import { jupyterClient } from '../jupyter-client/client.js';
import { createErrorResponse, type McpResponse } from './response-formatter.js';
import { logger } from './logger.js';
import { sessionNotebookStore } from './session-notebook-store.js';
import { sessionWorkspaceStore } from './session-workspace-store.js';
import { extractWorkspaceIdFromPath } from './workspace-path-store.js';

/**
 * セッション解決の結果
 */
export interface SessionResolution {
  kernelId: string;
  notebookPath: string | null;
}

/**
 * session_id から kernel_id と notebook_path を一度に解決する
 *
 * listSessions() を1回だけ呼び出し、両方の情報を返す。
 *
 * @param sessionId - session_id パラメータ
 * @returns kernel_id と notebook_path
 */
export async function resolveSession(sessionId: string): Promise<SessionResolution> {
  try {
    const sessions = await jupyterClient.listSessions();

    // 1. session.id で検索
    const sessionById = sessions.find((s) => s.id === sessionId);
    if (sessionById) {
      return {
        kernelId: sessionById.kernel.id,
        notebookPath: sessionById.path || null,
      };
    }

    // 2. session.kernel.id で検索（kernel_id フォールバック）
    const sessionByKernelId = sessions.find((s) => s.kernel?.id === sessionId);
    if (sessionByKernelId) {
      return {
        kernelId: sessionByKernelId.kernel.id,
        notebookPath: sessionByKernelId.path || null,
      };
    }

    // 3. セッションが見つからない場合: sessionId をそのまま使用 + ストア参照
    return {
      kernelId: sessionId,
      notebookPath: sessionNotebookStore.get(sessionId),
    };
  } catch (error) {
    logger.error('[resolveSession] Failed to list sessions:', error);
    return {
      kernelId: sessionId,
      notebookPath: sessionNotebookStore.get(sessionId),
    };
  }
}

/**
 * session_id を kernel_id に解決する
 *
 * @param sessionId - session_id パラメータ
 * @returns kernel_id
 */
export async function resolveKernelId(sessionId: string): Promise<string> {
  const { kernelId } = await resolveSession(sessionId);
  return kernelId;
}

/**
 * session_id から notebook_path を解決する
 *
 * @param sessionId - session_id パラメータ
 * @returns notebook_path または null
 */
export async function resolveNotebookPath(sessionId: string): Promise<string | null> {
  const { notebookPath } = await resolveSession(sessionId);
  return notebookPath;
}

/**
 * セッションIDとカーネルIDの両方をノートブックパスに紐付ける
 *
 * session_id → kernel_id の解決を行い、両方のIDでノートブックパスを参照できるようにする。
 * kernel_id の解決に失敗しても session_id の紐付けは保存される。
 */
export async function registerNotebookMapping(sessionId: string, notebookPath: string): Promise<void> {
  sessionNotebookStore.set(sessionId, notebookPath);
  try {
    const kernelId = await resolveKernelId(sessionId);
    if (kernelId !== sessionId) {
      sessionNotebookStore.set(kernelId, notebookPath);
    }
  } catch (error) {
    // kernel_id の解決に失敗しても session_id の紐付けは保存済み
    console.warn('[registerNotebookMapping] Failed to resolve kernelId:', error);
  }
}

/**
 * セッションIDからワークスペースIDを解決する
 *
 * 1. notebookPath からワークスペースIDを抽出
 * 2. 失敗時は sessionWorkspaceStore からフォールバック取得
 *
 * @returns ワークスペースID、特定できない場合は null
 */
export async function resolveWorkspaceId(sessionId: string): Promise<string | null> {
  const { notebookPath } = await resolveSession(sessionId);
  return (notebookPath ? await extractWorkspaceIdFromPath(notebookPath) : null) ?? sessionWorkspaceStore.get(sessionId);
}

/**
 * resolveWorkspaceId の結果をチェックし、null の場合はエラーレスポンスを返す
 *
 * @returns ワークスペースID、または WORKSPACE_NOT_FOUND エラーレスポンス
 */
export async function resolveWorkspaceIdOrError(
  sessionId: string,
): Promise<{ workspaceId: string } | { error: McpResponse }> {
  const workspaceId = await resolveWorkspaceId(sessionId);
  if (!workspaceId) {
    return {
      error: createErrorResponse(
        'セッションからワークスペースIDを特定できません。session_create で workspace_id を指定してセッションを作成してください。',
        'WORKSPACE_NOT_FOUND',
      ),
    };
  }
  return { workspaceId };
}
