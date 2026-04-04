/**
 * session_create ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateWorkspaceId } from '../utils/validation.js';
import { sessionNotebookStore } from '../utils/session-notebook-store.js';
import { sessionWorkspaceStore } from '../utils/session-workspace-store.js';
import { normalizePath } from '../utils/path-validator.js';
import { ValidationError } from '../utils/errors.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * 新しいセッション（カーネル）をワークスペース内に作成する
 */
export async function executeSessionCreate(args: Record<string, unknown>): Promise<McpResponse> {
  // 入力検証: workspace_id（必須、パストラバーサル防止含む）
  const workspaceIdValidation = validateWorkspaceId(args.workspace_id);
  if (!workspaceIdValidation.isValid) {
    return createErrorResponse(workspaceIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  const workspaceId = args.workspace_id as string;

  // 入力検証: notebook_path（任意）
  let notebookPath = args.notebook_path as string | undefined;
  if (notebookPath !== undefined) {
    try {
      notebookPath = normalizePath(notebookPath, { allowEmpty: false, maxLength: 500 });
    } catch (error) {
      const message = error instanceof ValidationError ? error.message : 'notebook_path が不正です';
      return createErrorResponse(message, 'VALIDATION_ERROR');
    }
  }

  try {
    const session = await jupyterClient.createSessionInWorkspace(workspaceId, notebookPath);

    // ストアに session/kernel ID → notebook_path の紐付けを保存
    if (session.notebook_path) {
      sessionNotebookStore.set(session.session_id, session.notebook_path);
      sessionNotebookStore.set(session.kernel_id, session.notebook_path);
    }

    // ストアに session/kernel ID → workspace_id の紐付けを常に保存
    // notebook_path なしの場合でも export_sql / execute_sql がワークスペースを特定できるようにする
    sessionWorkspaceStore.set(session.session_id, session.workspace_id);
    sessionWorkspaceStore.set(session.kernel_id, session.workspace_id);

    // browser_url の組み立て
    // session.notebook_path はワークスペースプレフィックス付き（例: workspaces/sample/ws-abc123/analysis.ipynb）
    const baseUrl = jupyterClient.baseUrl.replace(/\/$/, '');
    const wsPath = await resolveWorkspacePath(workspaceId);
    const browserUrl = session.notebook_path
      ? `${baseUrl}/lab/tree/${session.notebook_path}`
      : `${baseUrl}/lab/tree/${wsPath}`;

    return createSuccessResponse({
      session_id: session.session_id,
      kernel_id: session.kernel_id,
      workspace_id: session.workspace_id,
      ...(session.notebook_path ? { notebook_path: session.notebook_path } : {}),
      status: session.status,
      created_at: session.created_at,
      browser_url: browserUrl,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
