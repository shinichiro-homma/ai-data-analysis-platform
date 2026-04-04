/**
 * MCP ツール実行時のエラー定義
 */

import { McpBaseError } from '@ai-data-analysis/mcp-shared';

export class McpError extends McpBaseError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'McpError';
  }
}

export class NotFoundError extends McpError {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export class TimeoutError extends McpError {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`, 'TIMEOUT', 408);
  }
}
