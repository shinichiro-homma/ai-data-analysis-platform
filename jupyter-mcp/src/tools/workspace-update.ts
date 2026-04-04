/**
 * workspace_update ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import type { UpdateWorkspaceRequest } from '../jupyter-client/types.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import { validateWorkspaceId, validateWorkspaceMetadata } from '../utils/validation.js';

interface WorkspaceUpdateArgs {
  workspace_id?: string;
  summary?: string;
  status?: string;
}

/**
 * ワークスペースのメタデータを更新する
 */
export async function executeWorkspaceUpdate(args: Record<string, unknown>): Promise<McpResponse> {
  const { workspace_id, summary, status } = args as WorkspaceUpdateArgs;

  // workspace_id バリデーション（パストラバーサル防止を含む）
  const idValidation = validateWorkspaceId(workspace_id);
  if (!idValidation.isValid) {
    return createErrorResponse(idValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // summary と status の両方が未指定の場合はエラー
  if (summary === undefined && status === undefined) {
    return createErrorResponse('At least one of summary or status is required', 'VALIDATION_ERROR');
  }

  // summary / status バリデーション（共通関数）
  const metadataError = validateWorkspaceMetadata(summary, status);
  if (metadataError) {
    return createErrorResponse(metadataError, 'VALIDATION_ERROR');
  }

  try {
    const params: UpdateWorkspaceRequest = {};
    if (summary !== undefined) params.summary = summary;
    if (status !== undefined) params.status = status as UpdateWorkspaceRequest['status'];

    const workspace = await jupyterClient.updateWorkspace(workspace_id as string, params);

    return createSuccessResponse({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      summary: workspace.summary,
      status: workspace.status,
      path: workspace.path,
      data_path: workspace.data_path,
      output_path: workspace.output_path,
      created_at: workspace.created_at,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
