import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeAiEditStart } from '../../../src/tools/ai-edit-start.js';
import type { JupyterSession } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    listSessions: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeAiEditStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('session_id から notebook_path を解決し ai_edit_start イベントを配信', async () => {
      const mockSessions: JupyterSession[] = [
        {
          id: 'session-123',
          path: 'analysis.ipynb',
          name: 'analysis.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-456',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
      ];

      vi.mocked(jupyterClient.listSessions).mockResolvedValue(mockSessions);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeAiEditStart({ session_id: 'session-123' });

      // listSessions が呼ばれたことを確認
      expect(jupyterClient.listSessions).toHaveBeenCalled();

      // postAiEvent が正しいパラメータで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'ai_edit_start',
        notebook_path: 'analysis.ipynb',
      });

      // レスポンスを確認
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"locked": true');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
    });

    test('kernel_id として session_id が渡された場合も動作する', async () => {
      const mockSessions: JupyterSession[] = [
        {
          id: 'session-abc',
          path: 'data.ipynb',
          name: 'data.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-xyz',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
      ];

      vi.mocked(jupyterClient.listSessions).mockResolvedValue(mockSessions);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeAiEditStart({ session_id: 'kernel-xyz' });

      // kernel.id フォールバック検索でセッションが見つかる
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"locked": true');
      expect(result.content[0].text).toContain('"notebook_path": "data.ipynb"');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('session_id が未指定 => エラー', async () => {
      const result = await executeAiEditStart({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('session_id');
    });

    test('session_id が空文字 => エラー', async () => {
      const result = await executeAiEditStart({ session_id: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
    });

    test('session_id が数値 => エラー', async () => {
      const result = await executeAiEditStart({ session_id: 123 });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
    });
  });

  describe('異常系 - セッションが見つからない', () => {
    test('存在しない session_id => SESSION_NOT_FOUND エラー', async () => {
      vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

      const result = await executeAiEditStart({ session_id: 'invalid-session' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('SESSION_NOT_FOUND');
      expect(result.content[0].text).toContain('notebook_path 付きで作成されたセッション');
    });

    test('notebook_path なしで作成されたカーネルのみ => SESSION_NOT_FOUND', async () => {
      // listSessions が空配列を返す（カーネルのみで作成されたため）
      vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

      const result = await executeAiEditStart({ session_id: 'kernel-only-123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('SESSION_NOT_FOUND');
    });
  });

  describe('イベント配信の動作', () => {
    test('postAiEvent が正常に呼び出される', async () => {
      const mockSessions: JupyterSession[] = [
        {
          id: 'session-123',
          path: 'test.ipynb',
          name: 'test.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-456',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
      ];

      vi.mocked(jupyterClient.listSessions).mockResolvedValue(mockSessions);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeAiEditStart({ session_id: 'session-123' });

      // postAiEvent が呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'ai_edit_start',
        notebook_path: 'test.ipynb',
      });

      // ツール自体は成功
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"locked": true');
    });
  });
});
