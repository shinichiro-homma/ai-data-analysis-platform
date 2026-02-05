import { describe, test, expect } from 'vitest';
import {
  JupyterClientError,
  UnauthorizedError,
  KernelNotFoundError,
  KernelDeadError,
  NotebookNotFoundError,
  InvalidCellIndexError,
  ExecutionTimeoutError,
  ConnectionError,
  ValidationError,
  createErrorFromResponse,
} from '../../../src/jupyter-client/errors.js';

describe('JupyterClientError', () => {
  test('基底エラークラスのプロパティ', () => {
    const error = new JupyterClientError('Test message', 'TEST_CODE', 500);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('JupyterClientError');
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(500);
  });
});

describe('UnauthorizedError', () => {
  test('デフォルトメッセージ', () => {
    const error = new UnauthorizedError();

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('UnauthorizedError');
    expect(error.message).toContain('認証に失敗');
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.statusCode).toBe(401);
  });

  test('カスタムメッセージ', () => {
    const error = new UnauthorizedError('Custom auth error');

    expect(error.message).toBe('Custom auth error');
    expect(error.code).toBe('UNAUTHORIZED');
    expect(error.statusCode).toBe(401);
  });
});

describe('KernelNotFoundError', () => {
  test('カーネルIDを含むエラー', () => {
    const error = new KernelNotFoundError('kernel-123');

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('KernelNotFoundError');
    expect(error.message).toContain('kernel-123');
    expect(error.message).toContain('カーネルが見つかりません');
    expect(error.code).toBe('KERNEL_NOT_FOUND');
    expect(error.statusCode).toBe(404);
  });
});

describe('KernelDeadError', () => {
  test('カーネルIDを含むエラー', () => {
    const error = new KernelDeadError('kernel-456');

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('KernelDeadError');
    expect(error.message).toContain('kernel-456');
    expect(error.message).toContain('カーネルが停止しています');
    expect(error.code).toBe('KERNEL_DEAD');
    expect(error.statusCode).toBe(400);
  });
});

describe('NotebookNotFoundError', () => {
  test('パスを含むエラー', () => {
    const error = new NotebookNotFoundError('notebooks/test.ipynb');

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('NotebookNotFoundError');
    expect(error.message).toContain('notebooks/test.ipynb');
    expect(error.message).toContain('ノートブックが見つかりません');
    expect(error.code).toBe('NOTEBOOK_NOT_FOUND');
    expect(error.statusCode).toBe(404);
  });
});

describe('InvalidCellIndexError', () => {
  test('インデックスを含むエラー', () => {
    const error = new InvalidCellIndexError(99);

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('InvalidCellIndexError');
    expect(error.message).toContain('99');
    expect(error.message).toContain('セルインデックスが不正です');
    expect(error.code).toBe('INVALID_CELL_INDEX');
    expect(error.statusCode).toBe(400);
  });
});

describe('ExecutionTimeoutError', () => {
  test('タイムアウト時間を含むエラー', () => {
    const error = new ExecutionTimeoutError(30000);

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('ExecutionTimeoutError');
    expect(error.message).toContain('30000ms');
    expect(error.message).toContain('タイムアウト');
    expect(error.code).toBe('EXECUTION_TIMEOUT');
    expect(error.statusCode).toBe(408);
  });
});

describe('ConnectionError', () => {
  test('デフォルトメッセージ', () => {
    const error = new ConnectionError();

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('ConnectionError');
    expect(error.message).toContain('接続に失敗');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.statusCode).toBe(503);
  });

  test('カスタムメッセージ', () => {
    const error = new ConnectionError('Network error');

    expect(error.message).toBe('Network error');
    expect(error.code).toBe('CONNECTION_ERROR');
    expect(error.statusCode).toBe(503);
  });
});

describe('ValidationError', () => {
  test('バリデーションエラー', () => {
    const error = new ValidationError('Invalid input');

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
  });
});

describe('createErrorFromResponse', () => {
  test('UNAUTHORIZED => UnauthorizedError', () => {
    const error = createErrorFromResponse(401, 'UNAUTHORIZED', 'Auth failed');

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error.code).toBe('UNAUTHORIZED');
  });

  test('KERNEL_NOT_FOUND => KernelNotFoundError', () => {
    const error = createErrorFromResponse(404, 'KERNEL_NOT_FOUND', 'Not found', {
      kernelId: 'kernel-abc',
    });

    expect(error).toBeInstanceOf(KernelNotFoundError);
    expect(error.message).toContain('kernel-abc');
  });

  test('KERNEL_NOT_FOUND（コンテキストなし） => デフォルトID', () => {
    const error = createErrorFromResponse(404, 'KERNEL_NOT_FOUND', 'Not found');

    expect(error).toBeInstanceOf(KernelNotFoundError);
    expect(error.message).toContain('unknown');
  });

  test('KERNEL_DEAD => KernelDeadError', () => {
    const error = createErrorFromResponse(400, 'KERNEL_DEAD', 'Kernel dead', {
      kernelId: 'kernel-xyz',
    });

    expect(error).toBeInstanceOf(KernelDeadError);
    expect(error.message).toContain('kernel-xyz');
  });

  test('NOTEBOOK_NOT_FOUND => NotebookNotFoundError', () => {
    const error = createErrorFromResponse(404, 'NOTEBOOK_NOT_FOUND', 'Not found', {
      path: 'test.ipynb',
    });

    expect(error).toBeInstanceOf(NotebookNotFoundError);
    expect(error.message).toContain('test.ipynb');
  });

  test('INVALID_CELL_INDEX => InvalidCellIndexError', () => {
    const error = createErrorFromResponse(400, 'INVALID_CELL_INDEX', 'Invalid index', {
      index: 10,
    });

    expect(error).toBeInstanceOf(InvalidCellIndexError);
    expect(error.message).toContain('10');
  });

  test('EXECUTION_TIMEOUT => ExecutionTimeoutError', () => {
    const error = createErrorFromResponse(408, 'EXECUTION_TIMEOUT', 'Timeout');

    expect(error).toBeInstanceOf(ExecutionTimeoutError);
    expect(error.code).toBe('EXECUTION_TIMEOUT');
  });

  test('不明なエラーコード => JupyterClientError', () => {
    const error = createErrorFromResponse(500, 'UNKNOWN_ERROR', 'Unknown error');

    expect(error).toBeInstanceOf(JupyterClientError);
    expect(error.code).toBe('UNKNOWN_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('Unknown error');
  });
});
