import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeSessionCreate } from '../../../src/tools/session-create.js';
import type { WorkspaceSessionInfo } from '../../../src/jupyter-client/types.js';
import { sessionWorkspaceStore } from '../../../src/utils/session-workspace-store.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    createSessionInWorkspace: vi.fn(),
    baseUrl: 'http://localhost:8888',
  },
}));

// workspace-path-store をモック
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeSessionCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionWorkspaceStore.clear();
  });

  describe('正常系 - workspace_id 指定でセッション作成', () => {
    test('workspace_id のみ指定 => カーネルのみ作成', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'kernel-123',
        kernel_id: 'kernel-123',
        workspace_id: 'ws-abc123',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({ workspace_id: 'ws-abc123' });

      expect(jupyterClient.createSessionInWorkspace).toHaveBeenCalledWith('ws-abc123', undefined);
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"session_id": "kernel-123"');
      expect(result.content[0].text).toContain('"kernel_id": "kernel-123"');
      expect(result.content[0].text).toContain('"workspace_id": "ws-abc123"');
    });

    test('workspace_id + notebook_path 指定 => セッション（ノートブック+カーネル）作成', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'session-abc',
        kernel_id: 'kernel-xyz',
        workspace_id: 'ws-abc123',
        notebook_path: 'workspaces/ws-abc123/analysis.ipynb',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({
        workspace_id: 'ws-abc123',
        notebook_path: 'analysis.ipynb',
      });

      expect(jupyterClient.createSessionInWorkspace).toHaveBeenCalledWith('ws-abc123', 'analysis.ipynb');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"session_id": "session-abc"');
      expect(result.content[0].text).toContain('"kernel_id": "kernel-xyz"');
      expect(result.content[0].text).toContain('"workspace_id": "ws-abc123"');
      expect(result.content[0].text).toContain('"notebook_path": "workspaces/ws-abc123/analysis.ipynb"');
    });

    test('notebook_path 指定時の browser_url がノートブックURLになること', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'session-abc',
        kernel_id: 'kernel-xyz',
        workspace_id: 'ws-abc123',
        notebook_path: 'workspaces/ws-abc123/analysis.ipynb',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({
        workspace_id: 'ws-abc123',
        notebook_path: 'analysis.ipynb',
      });

      expect(result.content[0].text).toContain(
        '"browser_url": "http://localhost:8888/lab/tree/workspaces/ws-abc123/analysis.ipynb"',
      );
    });

    test('notebook_path 未指定時の browser_url がワークスペースディレクトリURLになること', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'kernel-123',
        kernel_id: 'kernel-123',
        workspace_id: 'ws-abc123',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      const result = await executeSessionCreate({ workspace_id: 'ws-abc123' });

      expect(result.content[0].text).toContain('"browser_url": "http://localhost:8888/lab/tree/workspaces/ws-abc123"');
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id が未指定 => エラー', async () => {
      const result = await executeSessionCreate({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id パラメータは必須です');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('workspace_id が空文字列 => エラー', async () => {
      const result = await executeSessionCreate({ workspace_id: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id パラメータが空です');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('workspace_id が長すぎる（51文字）=> エラー', async () => {
      const longId = 'a'.repeat(51);
      const result = await executeSessionCreate({ workspace_id: longId });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id が長すぎます');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('workspace_id にパス区切り文字を含む => エラー', async () => {
      const result = await executeSessionCreate({ workspace_id: '../evil' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('workspace_id に ".." を含む => エラー', async () => {
      const result = await executeSessionCreate({ workspace_id: '..evil' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("..'");
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('notebook_path が空文字列 => エラー', async () => {
      const result = await executeSessionCreate({
        workspace_id: 'ws-abc123',
        notebook_path: '',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('パスが空です');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });

    test('notebook_path が長すぎる => エラー', async () => {
      const longPath = 'a'.repeat(501);
      const result = await executeSessionCreate({
        workspace_id: 'ws-abc123',
        notebook_path: longPath,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('パスが長すぎます');
      expect(jupyterClient.createSessionInWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('sessionWorkspaceStore への保存', () => {
    test('notebook_path なしでも workspace_id がストアに保存される', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'session-abc',
        kernel_id: 'kernel-xyz',
        workspace_id: 'ws-abc123',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      await executeSessionCreate({ workspace_id: 'ws-abc123' });

      expect(sessionWorkspaceStore.get('session-abc')).toBe('ws-abc123');
      expect(sessionWorkspaceStore.get('kernel-xyz')).toBe('ws-abc123');
    });

    test('notebook_path ありでも workspace_id がストアに保存される', async () => {
      const mockSession: WorkspaceSessionInfo = {
        session_id: 'session-abc',
        kernel_id: 'kernel-xyz',
        workspace_id: 'ws-abc123',
        notebook_path: 'workspaces/ws-abc123/analysis.ipynb',
        status: 'starting',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createSessionInWorkspace).mockResolvedValue(mockSession);

      await executeSessionCreate({ workspace_id: 'ws-abc123', notebook_path: 'analysis.ipynb' });

      expect(sessionWorkspaceStore.get('session-abc')).toBe('ws-abc123');
      expect(sessionWorkspaceStore.get('kernel-xyz')).toBe('ws-abc123');
    });
  });

  describe('API エラー', () => {
    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.createSessionInWorkspace).mockRejectedValue(error);

      const result = await executeSessionCreate({ workspace_id: 'ws-abc123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });

    test('ワークスペースが存在しない => エラーレスポンス', async () => {
      const error = Object.assign(new Error('Workspace not found: ws-notexist'), {
        code: 'WORKSPACE_NOT_FOUND',
      });
      vi.mocked(jupyterClient.createSessionInWorkspace).mockRejectedValue(error);

      const result = await executeSessionCreate({ workspace_id: 'ws-notexist' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Workspace not found');
    });
  });
});
