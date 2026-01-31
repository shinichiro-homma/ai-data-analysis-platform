/**
 * MCP ツール実行時のエラー定義
 */

export class McpError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = "McpError";
  }
}

export class NotFoundError extends McpError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class ValidationError extends McpError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400);
  }
}

export class TimeoutError extends McpError {
  constructor(operation: string, timeoutMs: number) {
    super(
      `${operation} timed out after ${timeoutMs}ms`,
      "TIMEOUT",
      408
    );
  }
}
