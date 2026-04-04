import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeWorkspaceList } from '../../../src/tools/workspace-list.js';
import type { WorkspaceInfo } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    listWorkspaces: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeWorkspaceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('ワークスペースが複数存在する場合', async () => {
      const mockWorkspaces: WorkspaceInfo[] = [
        {
          workspace_id: 'ws-a1b2c3d4',
          name: '売上分析',
          path: 'workspaces/ws-a1b2c3d4',
          data_path: 'workspaces/ws-a1b2c3d4/data',
          output_path: 'workspaces/ws-a1b2c3d4/output',
          created_at: '2024-01-15T10:00:00Z',
          summary: '月次売上レポート作成',
          status: 'in_progress',
          file_count: 3,
        },
        {
          workspace_id: 'ws-e5f6g7h8',
          name: '顧客分析',
          path: 'workspaces/ws-e5f6g7h8',
          data_path: 'workspaces/ws-e5f6g7h8/data',
          output_path: 'workspaces/ws-e5f6g7h8/output',
          created_at: '2024-01-16T09:00:00Z',
          summary: '',
          status: 'not_started',
          file_count: 1,
        },
      ];

      vi.mocked(jupyterClient.listWorkspaces).mockResolvedValue(mockWorkspaces);

      const result = await executeWorkspaceList({});

      expect(jupyterClient.listWorkspaces).toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspace_id": "ws-a1b2c3d4"');
      expect(result.content[0].text).toContain('"name": "売上分析"');
      expect(result.content[0].text).toContain('"data_path": "data"');
      expect(result.content[0].text).toContain('"output_path": "output"');
      expect(result.content[0].text).toContain('"summary": "月次売上レポート作成"');
      expect(result.content[0].text).toContain('"status": "in_progress"');
      expect(result.content[0].text).toContain('"workspace_id": "ws-e5f6g7h8"');
      expect(result.content[0].text).toContain('"name": "顧客分析"');
    });

    test('ワークスペースが0件の場合', async () => {
      vi.mocked(jupyterClient.listWorkspaces).mockResolvedValue([]);

      const result = await executeWorkspaceList({});

      expect(jupyterClient.listWorkspaces).toHaveBeenCalled();
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspaces": []');
    });

    test('file_count が未定義の場合は 0 として返す', async () => {
      const mockWorkspaces: WorkspaceInfo[] = [
        {
          workspace_id: 'ws-a1b2c3d4',
          name: '売上分析',
          path: 'workspaces/ws-a1b2c3d4',
          data_path: 'workspaces/ws-a1b2c3d4/data',
          output_path: 'workspaces/ws-a1b2c3d4/output',
          created_at: '2024-01-15T10:00:00Z',
          summary: '',
          status: 'not_started',
          // file_count は未定義
        },
      ];

      vi.mocked(jupyterClient.listWorkspaces).mockResolvedValue(mockWorkspaces);

      const result = await executeWorkspaceList({});

      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"file_count": 0');
    });
  });

  describe('API エラー', () => {
    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.listWorkspaces).mockRejectedValue(error);

      const result = await executeWorkspaceList({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });

    test('サーバー内部エラー => エラーレスポンス', async () => {
      const error = Object.assign(new Error('Internal server error'), { code: 'INTERNAL_ERROR' });
      vi.mocked(jupyterClient.listWorkspaces).mockRejectedValue(error);

      const result = await executeWorkspaceList({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INTERNAL_ERROR');
    });
  });
});
