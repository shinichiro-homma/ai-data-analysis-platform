/**
 * jupyter-client エラークラス定義
 */

/**
 * Jupyter クライアントの基底エラークラス
 */
export class JupyterClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'JupyterClientError';
  }
}

/**
 * 認証エラー
 */
export class UnauthorizedError extends JupyterClientError {
  constructor(message = '認証に失敗しました。トークンを確認してください。') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * カーネルが見つからないエラー
 */
export class KernelNotFoundError extends JupyterClientError {
  constructor(kernelId: string) {
    super(`カーネルが見つかりません: ${kernelId}`, 'KERNEL_NOT_FOUND', 404);
    this.name = 'KernelNotFoundError';
  }
}

/**
 * カーネルが停止しているエラー
 */
export class KernelDeadError extends JupyterClientError {
  constructor(kernelId: string) {
    super(`カーネルが停止しています: ${kernelId}`, 'KERNEL_DEAD', 400);
    this.name = 'KernelDeadError';
  }
}

/**
 * ノートブックが見つからないエラー
 */
export class NotebookNotFoundError extends JupyterClientError {
  constructor(path: string) {
    super(`ノートブックが見つかりません: ${path}`, 'NOTEBOOK_NOT_FOUND', 404);
    this.name = 'NotebookNotFoundError';
  }
}

/**
 * セルインデックス不正エラー
 */
export class InvalidCellIndexError extends JupyterClientError {
  constructor(index: number) {
    super(`セルインデックスが不正です: ${index}`, 'INVALID_CELL_INDEX', 400);
    this.name = 'InvalidCellIndexError';
  }
}

/**
 * コード実行タイムアウトエラー
 */
export class ExecutionTimeoutError extends JupyterClientError {
  constructor(timeoutMs: number) {
    super(
      `コード実行がタイムアウトしました（${timeoutMs}ms）`,
      'EXECUTION_TIMEOUT',
      408
    );
    this.name = 'ExecutionTimeoutError';
  }
}

/**
 * 接続エラー
 */
export class ConnectionError extends JupyterClientError {
  constructor(message = 'jupyter-server への接続に失敗しました。') {
    super(message, 'CONNECTION_ERROR', 503);
    this.name = 'ConnectionError';
  }
}

/**
 * バリデーションエラー
 */
export class ValidationError extends JupyterClientError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ValidationError';
  }
}

/**
 * API エラーレスポンスからエラーを生成する
 */
export function createErrorFromResponse(
  statusCode: number,
  errorCode: string,
  message: string,
  context?: { kernelId?: string; path?: string; index?: number }
): JupyterClientError {
  switch (errorCode) {
    case 'UNAUTHORIZED':
      return new UnauthorizedError(message);
    case 'KERNEL_NOT_FOUND':
      return new KernelNotFoundError(context?.kernelId ?? 'unknown');
    case 'KERNEL_DEAD':
      return new KernelDeadError(context?.kernelId ?? 'unknown');
    case 'NOTEBOOK_NOT_FOUND':
      return new NotebookNotFoundError(context?.path ?? 'unknown');
    case 'INVALID_CELL_INDEX':
      return new InvalidCellIndexError(context?.index ?? -1);
    case 'EXECUTION_TIMEOUT':
      return new ExecutionTimeoutError(30000);
    default:
      return new JupyterClientError(message, errorCode, statusCode);
  }
}
