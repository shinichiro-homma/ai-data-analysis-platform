/**
 * workspace_summarize ツール実装
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

interface WorkspaceSummarizeArgs {
  workspace_id?: string;
}

/**
 * ワークスペースのサマリ生成用テンプレート・検証観点を取得する
 */
export async function executeWorkspaceSummarize(args: Record<string, unknown>): Promise<McpResponse> {
  const { workspace_id } = args as WorkspaceSummarizeArgs;

  // workspace_id バリデーション（パストラバーサル防止を含む）
  const idValidation = validateWorkspaceId(workspace_id);
  if (!idValidation.isValid) {
    return createErrorResponse(idValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  try {
    const result = await jupyterClient.summarizeWorkspace(workspace_id as string);

    return createSuccessResponse({
      workspace_id: result.workspace_id,
      template: result.template,
      verification_criteria: result.verification_criteria,
      instructions: result.instructions,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
