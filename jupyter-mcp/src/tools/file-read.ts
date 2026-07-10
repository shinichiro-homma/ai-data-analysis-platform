/**
 * file_read ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import { validateWorkspaceId, validateStringParameter } from '../utils/validation.js';
import { normalizePath } from '../utils/path-validator.js';
import { ValidationError } from '../utils/errors.js';
import { resolveWorkspacePath } from '../utils/workspace-path-store.js';

/**
 * ワークスペース内のテキストファイルの内容を取得する
 */
export async function executeFileRead(args: Record<string, unknown>): Promise<McpResponse> {
  // workspace_id の検証（必須）
  const workspaceIdValidation = validateWorkspaceId(args.workspace_id);
  if (!workspaceIdValidation.isValid) {
    return createErrorResponse(workspaceIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // file_path の検証（必須）
  const filePathValidation = validateStringParameter(args.file_path, 'file_path', {
    required: true,
    allowEmpty: false,
  });
  if (!filePathValidation.isValid) {
    return createErrorResponse(filePathValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  const workspace_id = args.workspace_id as string;
  const file_path = args.file_path as string;

  // .ipynb ファイルの拒否
  if (file_path.endsWith('.ipynb')) {
    return createErrorResponse(
      '.ipynb ファイルは file_read では読み取れません。ノートブック操作には notebook_list_cells を使用してください',
      'VALIDATION_ERROR',
    );
  }

  try {
    // パストラバーサル対策
    const normalizedFilePath = normalizePath(file_path);

    // ワークスペースパスを解決
    const wsPath = await resolveWorkspacePath(workspace_id);
    const fullPath = `${wsPath}/${normalizedFilePath}`;

    // テキストファイルの内容を取得
    const fileResponse = await jupyterClient.getTextFileContent(fullPath);

    return createSuccessResponse({ ...fileResponse });
  } catch (error) {
    // ValidationError の場合（パストラバーサル等）
    if (error instanceof ValidationError) {
      return createErrorResponse(error.message, error.code);
    }

    // その他のエラー
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

export const toolEntry: ToolEntry<McpToolResult> = {
  definition: {
    name: 'file_read',
    description:
      'Reads the content of a text file (e.g., .py, .sql, .md, .txt) in the workspace. Cannot read .ipynb files (use notebook_list_cells instead) or binary files.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Workspace ID' },
        file_path: {
          type: 'string',
          description: 'File path relative to workspace (e.g., scripts/analysis.py)',
        },
      },
      required: ['workspace_id', 'file_path'],
    },
  },
  execute: executeFileRead,
};
