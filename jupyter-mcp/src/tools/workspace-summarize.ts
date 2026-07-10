/**
 * workspace_summarize ツール実装
 */

import type { JupyterToolEntry } from './types.js';

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from '../utils/response-formatter.js';
import type { McpToolResult } from '../utils/response-formatter.js';
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

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: false,
  definition: {
    name: 'workspace_summarize',
    description:
      'Generates a verification report for the workspace. Only use when explicitly requested by the user. Returns a summary template, verification criteria (A-F), and report creation instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: {
          type: 'string',
          description: 'Workspace ID',
        },
      },
      required: ['workspace_id'],
    },
  },
  execute: executeWorkspaceSummarize,
};
