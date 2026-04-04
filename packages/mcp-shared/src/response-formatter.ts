/**
 * MCP レスポンスフォーマッター（共通）
 */

/**
 * MCP ツールのレスポンス型
 */
export interface McpResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * 成功レスポンスを生成
 */
export function createSuccessResponse(data: Record<string, unknown>): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            ...data,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * エラーレスポンスを生成
 */
export function createErrorResponse(message: string, code: string): McpResponse {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: false,
            error: {
              code,
              message,
            },
          },
          null,
          2,
        ),
      },
    ],
    isError: true,
  };
}

/**
 * エラーからコードを抽出
 */
export function extractErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'INTERNAL_ERROR';
}

/**
 * エラーからメッセージを抽出
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error';
}

/**
 * エラーからエラーレスポンスを生成（catch ブロック共通化用）
 */
export function createErrorResponseFromError(error: unknown): McpResponse {
  return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
}
