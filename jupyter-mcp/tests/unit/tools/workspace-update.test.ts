import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeWorkspaceUpdate } from '../../../src/tools/workspace-update.js';
import type { WorkspaceInfo } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    updateWorkspace: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeWorkspaceUpdate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockWorkspace: WorkspaceInfo = {
    workspace_id: 'ws-a1b2c3d4',
    name: '売上分析',
    path: 'workspaces/ws-a1b2c3d4',
    data_path: 'workspaces/ws-a1b2c3d4/data',
    output_path: 'workspaces/ws-a1b2c3d4/output',
    created_at: '2024-01-15T10:00:00Z',
    summary: '更新済みサマリ',
    status: 'in_progress',
  };

  describe('正常系', () => {
    test('summary のみ更新', async () => {
      vi.mocked(jupyterClient.updateWorkspace).mockResolvedValue({
        ...mockWorkspace,
        summary: '新しいサマリ',
        status: 'not_started',
      });

      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        summary: '新しいサマリ',
      });

      expect(jupyterClient.updateWorkspace).toHaveBeenCalledWith('ws-a1b2c3d4', { summary: '新しいサマリ' });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"summary": "新しいサマリ"');
    });

    test('status のみ更新', async () => {
      vi.mocked(jupyterClient.updateWorkspace).mockResolvedValue({
        ...mockWorkspace,
        status: 'completed',
      });

      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        status: 'completed',
      });

      expect(jupyterClient.updateWorkspace).toHaveBeenCalledWith('ws-a1b2c3d4', { status: 'completed' });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"status": "completed"');
    });

    test('summary と status を同時に更新', async () => {
      vi.mocked(jupyterClient.updateWorkspace).mockResolvedValue(mockWorkspace);

      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        summary: '更新済みサマリ',
        status: 'in_progress',
      });

      expect(jupyterClient.updateWorkspace).toHaveBeenCalledWith('ws-a1b2c3d4', {
        summary: '更新済みサマリ',
        status: 'in_progress',
      });
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspace_id": "ws-a1b2c3d4"');
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id 未指定 => エラー', async () => {
      const result = await executeWorkspaceUpdate({ summary: 'test' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id');
      expect(jupyterClient.updateWorkspace).not.toHaveBeenCalled();
    });

    test('summary と status の両方が未指定 => エラー', async () => {
      const result = await executeWorkspaceUpdate({ workspace_id: 'ws-a1b2c3d4' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('At least one of summary or status is required');
      expect(jupyterClient.updateWorkspace).not.toHaveBeenCalled();
    });

    test('不正な status 値 => エラー', async () => {
      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        status: 'invalid',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('status must be one of');
      expect(jupyterClient.updateWorkspace).not.toHaveBeenCalled();
    });

    test('summary が200文字超 => エラー', async () => {
      const longSummary = 'a'.repeat(201);
      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        summary: longSummary,
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('summary');
      expect(jupyterClient.updateWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('存在しない workspace_id => エラー', async () => {
      const error = Object.assign(new Error('Workspace not found'), { code: 'NOT_FOUND' });
      vi.mocked(jupyterClient.updateWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-nonexistent',
        summary: 'テスト',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('NOT_FOUND');
    });

    test('接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.updateWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceUpdate({
        workspace_id: 'ws-a1b2c3d4',
        status: 'in_progress',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
