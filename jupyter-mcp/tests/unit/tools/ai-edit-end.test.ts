import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeAiEditEnd } from '../../../src/tools/ai-edit-end.js';
import type { JupyterSession } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    listSessions: vi.fn(),
    postAiEvent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeAiEditEnd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('session_id から notebook_path を解決し ai_edit_end イベントを配信', async () => {
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

      const result = await executeAiEditEnd({ session_id: 'session-123' });

      // listSessions が呼ばれたことを確認
      expect(jupyterClient.listSessions).toHaveBeenCalled();

      // postAiEvent が正しいパラメータで呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'ai_edit_end',
        notebook_path: 'analysis.ipynb',
      });

      // レスポンスを確認
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"locked": false');
      expect(result.content[0].text).toContain('"notebook_path": "analysis.ipynb"');
    });

    test('複数のセッションがある場合でも正しいセッションを特定', async () => {
      const mockSessions: JupyterSession[] = [
        {
          id: 'session-001',
          path: 'notebook1.ipynb',
          name: 'notebook1.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-001',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
        {
          id: 'session-002',
          path: 'notebook2.ipynb',
          name: 'notebook2.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-002',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
      ];

      vi.mocked(jupyterClient.listSessions).mockResolvedValue(mockSessions);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeAiEditEnd({ session_id: 'session-002' });

      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'ai_edit_end',
        notebook_path: 'notebook2.ipynb',
      });

      expect(result.content[0].text).toContain('"notebook_path": "notebook2.ipynb"');
    });
  });

  describe('異常系 - バリデーションエラー', () => {
    test('session_id が未指定 => エラー', async () => {
      const result = await executeAiEditEnd({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(result.content[0].text).toContain('session_id');
    });

    test('session_id が空文字 => エラー', async () => {
      const result = await executeAiEditEnd({ session_id: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
    });

    test('session_id が null => エラー', async () => {
      const result = await executeAiEditEnd({ session_id: null });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
    });
  });

  describe('異常系 - セッションが見つからない', () => {
    test('存在しない session_id => SESSION_NOT_FOUND エラー', async () => {
      vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

      const result = await executeAiEditEnd({ session_id: 'non-existent' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('SESSION_NOT_FOUND');
      expect(result.content[0].text).toContain('notebook_path 付きで作成されたセッション');
    });

    test('kernel_id のみで作成されたセッション => SESSION_NOT_FOUND', async () => {
      vi.mocked(jupyterClient.listSessions).mockResolvedValue([]);

      const result = await executeAiEditEnd({ session_id: 'kernel-123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('SESSION_NOT_FOUND');
    });
  });

  describe('イベント配信の動作', () => {
    test('postAiEvent が正常に呼び出される', async () => {
      const mockSessions: JupyterSession[] = [
        {
          id: 'session-999',
          path: 'final.ipynb',
          name: 'final.ipynb',
          type: 'notebook',
          kernel: {
            id: 'kernel-999',
            name: 'python3',
            last_activity: '2024-01-01T00:00:00Z',
            execution_state: 'idle',
            connections: 1,
          },
        },
      ];

      vi.mocked(jupyterClient.listSessions).mockResolvedValue(mockSessions);
      vi.mocked(jupyterClient.postAiEvent).mockResolvedValue({ broadcasted: true, clients: 0 });

      const result = await executeAiEditEnd({ session_id: 'session-999' });

      // postAiEvent が呼ばれたことを確認
      expect(jupyterClient.postAiEvent).toHaveBeenCalledWith({
        type: 'ai_edit_end',
        notebook_path: 'final.ipynb',
      });

      // ツール自体は成功
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"locked": false');
    });
  });
});
