/**
 * MCP レスポンスフォーマッター
 */

// 共通関数・型を re-export
export {
  type McpResponse,
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  createErrorResponseFromError,
} from '@ai-data-analysis/mcp-shared';

/**
 * MCP image content type
 */
export interface McpImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * MCP ツールの統合レスポンス型（テキスト・画像両対応）
 */
export type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};
