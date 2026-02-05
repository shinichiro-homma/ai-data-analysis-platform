import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeExecuteCode } from '../../../src/tools/execute-code.js';
import type { ExecuteResult } from '../../../src/jupyter-client/types.js';

// jupyterClient と resolveKernelId をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    executeCode: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveKernelId: vi.fn(),
}));

vi.mock('../../../src/image-store/index.js', () => ({
  imageStore: {
    store: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveKernelId } from '../../../src/utils/session-resolver.js';

describe('executeExecuteCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveKernelId).mockResolvedValue('kernel-123');
  });

  describe('正常系', () => {
    test('コード実行成功 => 結果返却', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [
          { type: 'stdout', text: 'Hello, World!\n' },
        ],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 100,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("Hello, World!")',
      });

      expect(resolveKernelId).toHaveBeenCalledWith('session-123');
      expect(jupyterClient.executeCode).toHaveBeenCalledWith('kernel-123', {
        code: 'print("Hello, World!")',
        timeout: 30,
      });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('Hello, World!');
    });

    test('カスタムタイムアウト指定 => タイムアウト適用', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 1000,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      await executeExecuteCode({
        session_id: 'session-123',
        code: 'import time; time.sleep(1)',
        timeout: 60,
      });

      expect(jupyterClient.executeCode).toHaveBeenCalledWith('kernel-123', {
        code: 'import time; time.sleep(1)',
        timeout: 60,
      });
    });

    test('空のコード => 正常実行', async () => {
      const mockResult: ExecuteResult = {
        success: true,
        outputs: [],
        result: null,
        execution_count: 1,
        images: [],
        execution_time_ms: 10,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: '',
      });

      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('バリデーションエラー', () => {
    test('session_id が未指定 => エラー', async () => {
      const result = await executeExecuteCode({
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id パラメータは必須です');
      expect(jupyterClient.executeCode).not.toHaveBeenCalled();
    });

    test('session_id が空文字列 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: '',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id パラメータは必須です');
    });

    test('session_id が長すぎる => エラー', async () => {
      const longSessionId = 'a'.repeat(201);
      const result = await executeExecuteCode({
        session_id: longSessionId,
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id が長すぎます（最大200文字）');
    });

    test('code がNULLバイト含む => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test\0")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('code に不正な文字が含まれています');
    });

    test('timeout が0以下 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: 0,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout は正の数である必要があります');
    });

    test('timeout が300秒超 => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: 301,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout は最大 300 秒です');
    });

    test('timeout が数値でない => エラー', async () => {
      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
        timeout: '30' as any,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('timeout パラメータは数値である必要があります');
    });
  });

  describe('実行エラー', () => {
    test('コード実行でエラー => エラー情報返却', async () => {
      const mockResult: ExecuteResult = {
        success: false,
        outputs: [],
        result: null,
        error: {
          type: 'NameError',
          message: "name 'x' is not defined",
          traceback: ["Traceback (most recent call last):", "  ...", "NameError: name 'x' is not defined"],
        },
        execution_count: 1,
        images: [],
        execution_time_ms: 50,
      };

      vi.mocked(jupyterClient.executeCode).mockResolvedValue(mockResult);

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print(x)',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("name 'x' is not defined");
    });

    test('セッション解決失敗 => エラー', async () => {
      vi.mocked(resolveKernelId).mockRejectedValue(new Error('Session not found'));

      const result = await executeExecuteCode({
        session_id: 'nonexistent',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Session not found');
      expect(jupyterClient.executeCode).not.toHaveBeenCalled();
    });

    test('API呼び出し失敗 => エラー', async () => {
      vi.mocked(jupyterClient.executeCode).mockRejectedValue(
        new Error('Connection timeout')
      );

      const result = await executeExecuteCode({
        session_id: 'session-123',
        code: 'print("test")',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection timeout');
    });
  });
});
