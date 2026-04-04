import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeFileList } from '../../../src/tools/file-list.js';
import type { ContentsListResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    listContents: vi.fn(),
  },
}));

// workspace-path-store をモック（resolveWorkspacePath が API 呼び出しを行わないようにする）
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeFileList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('workspace_id 指定でワークスペースルートのファイル一覧を取得', async () => {
      const mockContents: ContentsListResponse = {
        path: '/workspaces/ws-abc123',
        contents: [
          { name: 'analysis.ipynb', type: 'notebook', size: 1024, modified_at: '2024-01-01T00:00:00Z' },
          { name: 'data.csv', type: 'file', size: 512, modified_at: '2024-01-01T00:00:00Z' },
        ],
      };

      vi.mocked(jupyterClient.listContents).mockResolvedValue(mockContents);

      const result = await executeFileList({ workspace_id: 'ws-abc123' });

      expect(jupyterClient.listContents).toHaveBeenCalledWith('workspaces/ws-abc123');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"path": "/"');
      expect(result.content[0].text).toContain('analysis.ipynb');
      expect(result.content[0].text).toContain('data.csv');
    });

    test('workspace_id + path 指定でサブディレクトリのファイル一覧を取得', async () => {
      const mockContents: ContentsListResponse = {
        path: '/workspaces/ws-abc123/data',
        contents: [{ name: 'sales.csv', type: 'file', size: 2048, modified_at: '2024-01-01T00:00:00Z' }],
      };

      vi.mocked(jupyterClient.listContents).mockResolvedValue(mockContents);

      const result = await executeFileList({
        workspace_id: 'ws-abc123',
        path: 'data',
      });

      expect(jupyterClient.listContents).toHaveBeenCalledWith('workspaces/ws-abc123/data');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"path": "/data"');
      expect(result.content[0].text).toContain('sales.csv');
    });

    test('path="/" を指定 => ワークスペースルートのファイル一覧を取得', async () => {
      const mockContents: ContentsListResponse = {
        path: '/workspaces/ws-abc123',
        contents: [],
      };

      vi.mocked(jupyterClient.listContents).mockResolvedValue(mockContents);

      const result = await executeFileList({
        workspace_id: 'ws-abc123',
        path: '/',
      });

      expect(jupyterClient.listContents).toHaveBeenCalledWith('workspaces/ws-abc123');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('"path": "/"');
    });

    test('path 省略 => ワークスペースルートのファイル一覧を取得', async () => {
      const mockContents: ContentsListResponse = {
        path: '/workspaces/ws-abc123',
        contents: [],
      };

      vi.mocked(jupyterClient.listContents).mockResolvedValue(mockContents);

      const result = await executeFileList({ workspace_id: 'ws-abc123' });

      expect(jupyterClient.listContents).toHaveBeenCalledWith('workspaces/ws-abc123');
      expect(result.content[0].text).toContain('"path": "/"');
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id が未指定 => エラー', async () => {
      const result = await executeFileList({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id パラメータは必須です');
      expect(jupyterClient.listContents).not.toHaveBeenCalled();
    });

    test('workspace_id が空文字列 => エラー', async () => {
      const result = await executeFileList({ workspace_id: '' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id パラメータが空です');
      expect(jupyterClient.listContents).not.toHaveBeenCalled();
    });

    test('workspace_id にパス区切り文字を含む => パストラバーサル防止エラー', async () => {
      const result = await executeFileList({ workspace_id: '../etc' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(jupyterClient.listContents).not.toHaveBeenCalled();
    });

    test('workspace_id に ".." を含む => パストラバーサル防止エラー', async () => {
      const result = await executeFileList({ workspace_id: '..etc' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain("..'");
      expect(jupyterClient.listContents).not.toHaveBeenCalled();
    });

    test('path に ".." を含む => パストラバーサル防止エラー', async () => {
      const result = await executeFileList({
        workspace_id: 'ws-abc123',
        path: '../etc/passwd',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('..');
      expect(jupyterClient.listContents).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('jupyter-server 接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.listContents).mockRejectedValue(error);

      const result = await executeFileList({ workspace_id: 'ws-abc123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
