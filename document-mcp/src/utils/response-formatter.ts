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
