/**
 * workspace_create ツール実装
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
import { validateStringParameter, validateWorkspaceMetadata, WORKSPACE_STATUS_SCHEMA } from '../utils/validation.js';
import { toKernelRelativePath } from '../utils/workspace-path.js';
import { registerWorkspacePath } from '../utils/workspace-path-store.js';

interface WorkspaceCreateArgs {
  name?: string;
  summary?: string;
  status?: string;
}

/**
 * ワークスペースを作成する
 */
export async function executeWorkspaceCreate(args: Record<string, unknown>): Promise<McpResponse> {
  const { name, summary, status } = args as WorkspaceCreateArgs;

  // 入力検証: name パラメータ
  const nameValidation = validateStringParameter(name, 'name', {
    required: true,
    maxLength: 100,
    allowEmpty: false,
  });

  if (!nameValidation.isValid) {
    return createErrorResponse(nameValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // パストラバーサル防止: name にディレクトリ区切りや ".." を含めない
  const nameStr = name as string;
  if (nameStr.includes('..') || nameStr.includes('/') || nameStr.includes('\\')) {
    return createErrorResponse("name に '..', '/', '\\' を含めることはできません", 'VALIDATION_ERROR');
  }

  // summary / status バリデーション（共通関数）
  const metadataError = validateWorkspaceMetadata(summary, status);
  if (metadataError) {
    return createErrorResponse(metadataError, 'VALIDATION_ERROR');
  }

  try {
    const workspace = await jupyterClient.createWorkspace(name as string, summary, status);

    // パスキャッシュに登録
    registerWorkspacePath(workspace.workspace_id, workspace.path);

    const kernelDataPath = toKernelRelativePath(workspace.data_path, workspace.path);
    const kernelOutputPath = toKernelRelativePath(workspace.output_path, workspace.path);

    return createSuccessResponse({
      workspace_id: workspace.workspace_id,
      name: workspace.name,
      path: workspace.path,
      data_path: kernelDataPath,
      output_path: kernelOutputPath,
      created_at: workspace.created_at,
      summary: workspace.summary,
      status: workspace.status,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: false,
  definition: {
    name: 'workspace_create',
    description:
      'Creates a new workspace (isolated working directory). This is the FIRST step to start data analysis. Each chat gets an independent directory with data/ for datasets and output/ for results and charts. After creation, call session_create to start a session.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Workspace name (max 100 characters)',
        },
        summary: {
          type: 'string',
          description: 'Workspace summary describing the analysis content (max 200 characters)',
        },
        status: {
          ...WORKSPACE_STATUS_SCHEMA,
          description: 'Workspace status (default: not_started)',
        },
      },
      required: ['name'],
    },
  },
  execute: executeWorkspaceCreate,
};
