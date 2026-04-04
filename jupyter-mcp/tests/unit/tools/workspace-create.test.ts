import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeWorkspaceCreate } from '../../../src/tools/workspace-create.js';
import type { WorkspaceInfo } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    createWorkspace: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeWorkspaceCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('name指定でワークスペースを作成する', async () => {
      const mockWorkspace: WorkspaceInfo = {
        workspace_id: 'ws-a1b2c3d4',
        name: '売上分析',
        path: 'workspaces/ws-a1b2c3d4',
        data_path: 'workspaces/ws-a1b2c3d4/data',
        output_path: 'workspaces/ws-a1b2c3d4/output',
        created_at: '2024-01-15T10:00:00Z',
        summary: '',
        status: 'not_started',
      };

      vi.mocked(jupyterClient.createWorkspace).mockResolvedValue(mockWorkspace);

      const result = await executeWorkspaceCreate({ name: '売上分析' });

      expect(jupyterClient.createWorkspace).toHaveBeenCalledWith('売上分析', undefined, undefined);
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspace_id": "ws-a1b2c3d4"');
      expect(result.content[0].text).toContain('"name": "売上分析"');
      expect(result.content[0].text).toContain('"path": "workspaces/ws-a1b2c3d4"');
      expect(result.content[0].text).toContain('"data_path": "data"');
      expect(result.content[0].text).toContain('"output_path": "output"');
    });

    test('英数字のname指定でワークスペースを作成する', async () => {
      const mockWorkspace: WorkspaceInfo = {
        workspace_id: 'ws-e5f6g7h8',
        name: 'analysis-2024',
        path: 'workspaces/ws-e5f6g7h8',
        data_path: 'workspaces/ws-e5f6g7h8/data',
        output_path: 'workspaces/ws-e5f6g7h8/output',
        created_at: '2024-01-15T11:00:00Z',
        summary: '',
        status: 'not_started',
      };

      vi.mocked(jupyterClient.createWorkspace).mockResolvedValue(mockWorkspace);

      const result = await executeWorkspaceCreate({ name: 'analysis-2024' });

      expect(jupyterClient.createWorkspace).toHaveBeenCalledWith('analysis-2024', undefined, undefined);
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspace_id": "ws-e5f6g7h8"');
    });

    test('summary/status指定でワークスペースを作成する', async () => {
      const mockWorkspace: WorkspaceInfo = {
        workspace_id: 'ws-i9j0k1l2',
        name: '月次レポート',
        path: 'workspaces/ws-i9j0k1l2',
        data_path: 'workspaces/ws-i9j0k1l2/data',
        output_path: 'workspaces/ws-i9j0k1l2/output',
        created_at: '2024-01-15T12:00:00Z',
        summary: '2024年1月の売上分析',
        status: 'in_progress',
      };

      vi.mocked(jupyterClient.createWorkspace).mockResolvedValue(mockWorkspace);

      const result = await executeWorkspaceCreate({
        name: '月次レポート',
        summary: '2024年1月の売上分析',
        status: 'in_progress',
      });

      expect(jupyterClient.createWorkspace).toHaveBeenCalledWith('月次レポート', '2024年1月の売上分析', 'in_progress');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"summary": "2024年1月の売上分析"');
      expect(result.content[0].text).toContain('"status": "in_progress"');
    });

    test('summary/status省略時はデフォルト値で作成される', async () => {
      const mockWorkspace: WorkspaceInfo = {
        workspace_id: 'ws-m3n4o5p6',
        name: 'テスト',
        path: 'workspaces/ws-m3n4o5p6',
        data_path: 'workspaces/ws-m3n4o5p6/data',
        output_path: 'workspaces/ws-m3n4o5p6/output',
        created_at: '2024-01-15T13:00:00Z',
        summary: '',
        status: 'not_started',
      };

      vi.mocked(jupyterClient.createWorkspace).mockResolvedValue(mockWorkspace);

      const result = await executeWorkspaceCreate({ name: 'テスト' });

      expect(result.content[0].text).toContain('"summary": ""');
      expect(result.content[0].text).toContain('"status": "not_started"');
    });
  });

  describe('バリデーションエラー', () => {
    test('nameが未指定 => エラー', async () => {
      const result = await executeWorkspaceCreate({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });

    test('nameが空文字列 => エラー', async () => {
      const result = await executeWorkspaceCreate({ name: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name パラメータが空です');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });

    test('nameが長すぎる（101文字）=> エラー', async () => {
      const longName = 'a'.repeat(101);
      const result = await executeWorkspaceCreate({ name: longName });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name が長すぎます');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });

    test('不正なstatus値 => エラー', async () => {
      const result = await executeWorkspaceCreate({ name: 'テスト', status: 'invalid_status' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('status must be one of');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });

    test('summaryが201文字 => エラー', async () => {
      const longSummary = 'a'.repeat(201);
      const result = await executeWorkspaceCreate({ name: 'テスト', summary: longSummary });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('summary');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });

    test('nameにNULLバイトが含まれる => エラー', async () => {
      const result = await executeWorkspaceCreate({ name: 'test\0workspace' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name に不正な文字が含まれています');
      expect(jupyterClient.createWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.createWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceCreate({ name: '売上分析' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });

    test('サーバー内部エラー => エラーレスポンス', async () => {
      const error = Object.assign(new Error('Internal server error'), { code: 'INTERNAL_ERROR' });
      vi.mocked(jupyterClient.createWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceCreate({ name: '売上分析' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('INTERNAL_ERROR');
    });
  });
});
