import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeKernelRestart } from '../../../src/tools/kernel-restart.js';

// jupyterClient と resolveKernelId をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    restartKernel: vi.fn(),
  },
}));

vi.mock('../../../src/utils/session-resolver.js', () => ({
  resolveKernelId: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';
import { resolveKernelId } from '../../../src/utils/session-resolver.js';

describe('executeKernelRestart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveKernelId).mockResolvedValue('kernel-abc');
  });

  describe('正常系', () => {
    test('session_id 指定でカーネル再起動成功、kernel_id と status が返る', async () => {
      vi.mocked(jupyterClient.restartKernel).mockResolvedValue({
        id: 'kernel-abc',
        name: 'python3',
        status: 'starting',
        started_at: '2026-04-08T00:00:00Z',
      });

      const result = await executeKernelRestart({
        session_id: 'session-123',
      });

      // resolveKernelId が呼ばれたことを確認
      expect(resolveKernelId).toHaveBeenCalledWith('session-123');

      // restartKernel が正しい引数で呼ばれたことを確認
      expect(jupyterClient.restartKernel).toHaveBeenCalledWith('kernel-abc');

      // レスポンスに kernel_id と status が含まれることを確認
      const responseText = result.content[0].text;
      const responseJson = JSON.parse(responseText);
      expect(responseJson.success).toBe(true);
      expect(responseJson.kernel_id).toBe('kernel-abc');
      expect(responseJson.status).toBe('restarting');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('session_id 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeKernelRestart({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('session_id');
      expect(resolveKernelId).not.toHaveBeenCalled();
      expect(jupyterClient.restartKernel).not.toHaveBeenCalled();
    });
  });

  describe('異常系 - セッション解決エラー', () => {
    test('セッションが見つからない場合 => エラーレスポンス', async () => {
      const error = new Error('Session not found: session-999');
      (error as Record<string, unknown>).code = 'SESSION_NOT_FOUND';
      vi.mocked(resolveKernelId).mockRejectedValue(error);

      const result = await executeKernelRestart({
        session_id: 'session-999',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('SESSION_NOT_FOUND');
    });
  });

  describe('異常系 - API エラー', () => {
    test('カーネル未存在等の API エラー => エラーレスポンス', async () => {
      const error = new Error('Kernel not found: kernel-abc');
      (error as Record<string, unknown>).code = 'KERNEL_NOT_FOUND';
      vi.mocked(jupyterClient.restartKernel).mockRejectedValue(error);

      const result = await executeKernelRestart({
        session_id: 'session-123',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('KERNEL_NOT_FOUND');
    });
  });
});
