/**
 * notebook_create ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import type { JupyterToolEntry } from './types.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import { validateStringParameter, validateWorkspaceId } from '../utils/validation.js';
import { registerNotebookMapping } from '../utils/session-resolver.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * ワークスペース内に新しいノートブックを作成する
 */
export async function executeNotebookCreate(args: Record<string, unknown>): Promise<McpResponse> {
  // workspace_id 検証（必須、パストラバーサル防止含む）
  const workspaceIdValidation = validateWorkspaceId(args.workspace_id);
  if (!workspaceIdValidation.isValid) {
    return createErrorResponse(workspaceIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const workspace_id = args.workspace_id as string;

  // session_id 検証（必須）
  const sessionIdValidation = validateStringParameter(args.session_id, 'session_id', {
    required: true,
  });
  if (!sessionIdValidation.isValid) {
    return createErrorResponse(sessionIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // name 検証（必須、null バイト攻撃対策を含む）
  const nameValidation = validateStringParameter(args.name, 'name', {
    required: true,
    maxLength: 200,
  });
  if (!nameValidation.isValid) {
    return createErrorResponse(nameValidation.errorMessage!, 'VALIDATION_ERROR');
  }
  const name = args.name as string;

  // パストラバーサル攻撃対策
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return createErrorResponse(
      "ノートブック名に無効な文字（'..', '/', '\\\\'）を含めることはできません",
      'VALIDATION_ERROR',
    );
  }

  try {
    // ノートブック名の処理（.ipynb 拡張子を追加）
    const notebookName = name.endsWith('.ipynb') ? name : `${name}.ipynb`;

    // ワークスペース内のフルパスを構築
    const wsPath = await resolveWorkspacePath(workspace_id);
    const fullPath = `${wsPath}/${notebookName}`;

    // ノートブックを作成
    const result = await jupyterClient.createNotebook(fullPath);

    // ストアに session/kernel ID → notebook_path の紐付けを保存
    const sessionId = args.session_id as string;
    await registerNotebookMapping(sessionId, result.path);

    return createSuccessResponse({
      path: result.path,
      workspace_id,
      created_at: result.created_at,
      message: `ノートブック "${notebookName}" を作成しました`,
    });
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: false,
  definition: {
    name: 'notebook_create',
    description: 'Creates a new notebook within the workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Workspace ID' },
        session_id: { type: 'string', description: 'Session ID' },
        name: { type: 'string', description: 'Notebook name (.ipynb extension not required)' },
      },
      required: ['workspace_id', 'session_id', 'name'],
    },
  },
  execute: executeNotebookCreate,
};
