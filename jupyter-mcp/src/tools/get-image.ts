/**
 * get_image ツール実装
 *
 * execute_code のレスポンスに含まれる file_path を指定して、
 * 画像データを MCP image content type で取得する。
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpToolResult,
} from '../utils/response-formatter.js';
import { validateStringParameter } from '../utils/validation.js';

interface GetImageArgs {
  file_path: string;
}

/**
 * MIME タイプから MCP image content type の mimeType に変換する。
 * SVG は text/plain として扱われる場合があるため、ファイル拡張子も考慮する。
 */
function resolveImageMimeType(mimetype: string, filePath: string): string {
  // Jupyter API が返す mimetype をそのまま使う
  if (mimetype.startsWith('image/')) {
    return mimetype;
  }

  // ファイル拡張子からフォールバック
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'svg':
      return 'image/svg+xml';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return mimetype || 'application/octet-stream';
  }
}

/**
 * 画像ファイルを取得し、MCP image content type で返す
 */
export async function executeGetImage(args: Record<string, unknown>): Promise<McpToolResult> {
  const { file_path } = args as Partial<GetImageArgs>;

  // 入力検証: file_path
  const filePathValidation = validateStringParameter(file_path, 'file_path', {
    required: true,
    maxLength: 500,
    allowEmpty: false,
  });

  if (!filePathValidation.isValid) {
    return {
      ...createErrorResponse(filePathValidation.errorMessage!, 'VALIDATION_ERROR'),
      isError: true,
    };
  }

  const validatedFilePath = file_path as string;

  // パストラバーサル防止: ".." を含むパスを拒否
  if (validatedFilePath.includes('..')) {
    return {
      ...createErrorResponse("file_path に '..' を含めることはできません", 'VALIDATION_ERROR'),
      isError: true,
    };
  }

  // ワークスペース外アクセス防止: workspaces/ プレフィックスを要求
  if (!validatedFilePath.startsWith('workspaces/')) {
    return {
      ...createErrorResponse('file_path はワークスペース内のパスを指定してください', 'VALIDATION_ERROR'),
      isError: true,
    };
  }

  try {
    const file = await jupyterClient.getFileContent(validatedFilePath);
    const mimeType = resolveImageMimeType(file.mimetype, validatedFilePath);

    return {
      content: [
        {
          type: 'image',
          data: file.content,
          mimeType,
        },
      ],
    };
  } catch (error) {
    return {
      ...createErrorResponse(extractErrorMessage(error), extractErrorCode(error)),
      isError: true,
    };
  }
}
