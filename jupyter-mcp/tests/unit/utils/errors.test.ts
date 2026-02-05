import { describe, test, expect } from 'vitest';
import { McpError, NotFoundError, ValidationError, TimeoutError } from '../../../src/utils/errors.js';

describe('McpError', () => {
  test('基底エラークラスのプロパティ', () => {
    const error = new McpError('Test message', 'TEST_CODE', 500);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('McpError');
    expect(error.message).toBe('Test message');
    expect(error.code).toBe('TEST_CODE');
    expect(error.statusCode).toBe(500);
  });

  test('デフォルトstatusCode => 500', () => {
    const error = new McpError('Test message', 'TEST_CODE');

    expect(error.statusCode).toBe(500);
  });
});

describe('NotFoundError', () => {
  test('リソース名を含むエラー', () => {
    const error = new NotFoundError('session-123');

    expect(error).toBeInstanceOf(McpError);
    expect(error.message).toContain('session-123');
    expect(error.message).toContain('not found');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.statusCode).toBe(404);
  });
});

describe('ValidationError', () => {
  test('バリデーションエラー', () => {
    const error = new ValidationError('Invalid parameter');

    expect(error).toBeInstanceOf(McpError);
    expect(error.message).toBe('Invalid parameter');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
  });
});

describe('TimeoutError', () => {
  test('タイムアウトエラー', () => {
    const error = new TimeoutError('code execution', 30000);

    expect(error).toBeInstanceOf(McpError);
    expect(error.message).toContain('code execution');
    expect(error.message).toContain('30000ms');
    expect(error.message).toContain('timed out');
    expect(error.code).toBe('TIMEOUT');
    expect(error.statusCode).toBe(408);
  });
});
