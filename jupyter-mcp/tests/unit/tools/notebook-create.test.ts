import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeNotebookCreate } from '../../../src/tools/notebook-create.js';
import type { CreateContentResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    createNotebook: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
  },
}));

// workspace-path-store をモック
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeNotebookCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('workspace_id + session_id + name でワークスペース内にノートブック作成', async () => {
      const mockResult: CreateContentResponse = {
        path: '/workspaces/ws-abc123/analysis.ipynb',
        type: 'notebook',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createNotebook).mockResolvedValue(mockResult);

      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(jupyterClient.createNotebook).toHaveBeenCalledWith('workspaces/ws-abc123/analysis.ipynb');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"workspace_id": "ws-abc123"');
      expect(result.content[0].text).toContain('/workspaces/ws-abc123/analysis.ipynb');
    });

    test('.ipynb 拡張子あり指定 => 拡張子を二重追加しない', async () => {
      const mockResult: CreateContentResponse = {
        path: '/workspaces/ws-abc123/report.ipynb',
        type: 'notebook',
        created_at: '2024-01-01T00:00:00Z',
      };

      vi.mocked(jupyterClient.createNotebook).mockResolvedValue(mockResult);

      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
        name: 'report.ipynb',
      });

      expect(jupyterClient.createNotebook).toHaveBeenCalledWith('workspaces/ws-abc123/report.ipynb');
      expect(result.content[0].text).toContain('"success": true');
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id が未指定 => エラー', async () => {
      const result = await executeNotebookCreate({
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id パラメータは必須です');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('session_id が未指定 => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('session_id パラメータは必須です');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('name が未指定 => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('name パラメータは必須です');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('workspace_id にパス区切り文字を含む => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: '../evil',
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('workspace_id に ".." を含む => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: '..evil',
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("..'");
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('name に ".." を含む => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
        name: '../evil',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("'..'");
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('name に NULL バイトを含む => エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
        name: 'evil\0notebook',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('不正な文字');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });

    test('workspace_id が長すぎる（51文字）=> エラー', async () => {
      const result = await executeNotebookCreate({
        workspace_id: 'a'.repeat(51),
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id が長すぎます');
      expect(jupyterClient.createNotebook).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.createNotebook).mockRejectedValue(error);

      const result = await executeNotebookCreate({
        workspace_id: 'ws-abc123',
        session_id: 'kernel-123',
        name: 'analysis',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
