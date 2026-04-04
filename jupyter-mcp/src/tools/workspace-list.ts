/**
 * workspace_list ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { toKernelRelativePath } from '../utils/workspace-path.js';
import { registerWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * ワークスペース一覧を取得する
 */
export async function executeWorkspaceList(_args: Record<string, unknown>): Promise<McpResponse> {
  try {
    const workspaces = await jupyterClient.listWorkspaces();

    // パスキャッシュに登録
    for (const ws of workspaces) {
      registerWorkspacePath(ws.workspace_id, ws.path);
    }

    return createSuccessResponse({
      workspaces: workspaces.map((ws) => ({
        workspace_id: ws.workspace_id,
        name: ws.name,
        path: ws.path,
        data_path: toKernelRelativePath(ws.data_path, ws.path),
        output_path: toKernelRelativePath(ws.output_path, ws.path),
        created_at: ws.created_at,
        summary: ws.summary,
        status: ws.status,
        file_count: ws.file_count ?? 0,
      })),
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
