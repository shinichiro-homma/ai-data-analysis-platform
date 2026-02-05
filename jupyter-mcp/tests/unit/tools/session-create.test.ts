import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeSessionCreate } from '../../../src/tools/session-create.js';
import type { KernelInfo, SessionInfo } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    createKernel: vi.fn(),
    createSession: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeSessionCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系 - カーネルのみ作成', () => {
    test('デフォルトパラメータ => python3カーネル作成', async () => {
      const mockKernel: KernelInfo = {
        id: 'kernel-123',
        name: 'python3',
        execution_state: 'idle',
        last_activity: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createKernel).mockResolvedValue(mockKernel);

      const result = await executeSessionCreate({});

      expect(jupyterClient.createKernel).toHaveBeenCalledWith('python3');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"session_id": "kernel-123"');
      expect(result.content[0].text).toContain('"kernel_id": "kernel-123"');
    });

    test('カスタムカーネル名指定 => 指定したカーネル作成', async () => {
      const mockKernel: KernelInfo = {
        id: 'kernel-456',
        name: 'custom-kernel',
        execution_state: 'idle',
        last_activity: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createKernel).mockResolvedValue(mockKernel);

      const result = await executeSessionCreate({ name: 'custom-kernel' });

      expect(jupyterClient.createKernel).toHaveBeenCalledWith('custom-kernel');
      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('正常系 - セッション作成（ノートブック+カーネル）', () => {
    test('notebook_path指定 => セッション作成', async () => {
      const mockSession: SessionInfo = {
        id: 'session-abc',
        path: 'analysis.ipynb',
        name: 'analysis.ipynb',
        type: 'notebook',
        kernel: {
          id: 'kernel-xyz',
          name: 'python3',
          execution_state: 'idle',
          last_activity: '2024-01-01T00:00:00Z',
        },
      };

      vi.mocked(jupyterClient.createSession).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({ notebook_path: 'analysis.ipynb' });

      expect(jupyterClient.createSession).toHaveBeenCalledWith('analysis.ipynb', 'python3');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"session_id": "session-abc"');
      expect(result.content[0].text).toContain('"kernel_id": "kernel-xyz"');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
    });

    test('notebook_pathとname指定 => カスタムカーネルでセッション作成', async () => {
      const mockSession: SessionInfo = {
        id: 'session-def',
        path: 'test.ipynb',
        name: 'test.ipynb',
        type: 'notebook',
        kernel: {
          id: 'kernel-123',
          name: 'custom-kernel',
          execution_state: 'idle',
          last_activity: '2024-01-01T00:00:00Z',
        },
      };

      vi.mocked(jupyterClient.createSession).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({
        notebook_path: 'test.ipynb',
        name: 'custom-kernel',
      });

      expect(jupyterClient.createSession).toHaveBeenCalledWith('test.ipynb', 'custom-kernel');
      expect(result.content[0].text).toContain('"success": true');
    });

    test('notebook_pathが空文字列 => バリデーションエラー', async () => {
      const result = await executeSessionCreate({ notebook_path: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('notebook_path パラメータが空です');
      expect(jupyterClient.createKernel).not.toHaveBeenCalled();
      expect(jupyterClient.createSession).not.toHaveBeenCalled();
    });
  });

  describe('バリデーションエラー', () => {
    test('name が長すぎる => エラー', async () => {
      const longName = 'a'.repeat(101);
      const result = await executeSessionCreate({ name: longName });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name が長すぎます');
      expect(jupyterClient.createKernel).not.toHaveBeenCalled();
    });

    test('name が空文字列 => エラー', async () => {
      const result = await executeSessionCreate({ name: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name パラメータが空です');
    });

    test('notebook_path が長すぎる => エラー', async () => {
      const longPath = 'a'.repeat(501);
      const result = await executeSessionCreate({ notebook_path: longPath });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('notebook_path が長すぎます');
      expect(jupyterClient.createSession).not.toHaveBeenCalled();
    });

    test('name がNULLバイト含む => エラー', async () => {
      const result = await executeSessionCreate({ name: 'test\0kernel' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name に不正な文字が含まれています');
    });
  });

  describe('API エラー', () => {
    test('カーネル作成失敗 => エラーレスポンス', async () => {
      const error = new Error('Failed to create kernel');
      vi.mocked(jupyterClient.createKernel).mockRejectedValue(error);

      const result = await executeSessionCreate({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Failed to create kernel');
    });

    test('セッション作成失敗 => エラーレスポンス', async () => {
      const error = new Error('Failed to create session');
      vi.mocked(jupyterClient.createSession).mockRejectedValue(error);

      const result = await executeSessionCreate({ notebook_path: 'test.ipynb' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Failed to create session');
    });
  });
});
