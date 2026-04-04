import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeFileRead } from '../../../src/tools/file-read.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    getTextFileContent: vi.fn(),
  },
}));

// workspace-path-store をモック（resolveWorkspacePath が API 呼び出しを行わないようにする）
vi.mock('../../../src/utils/workspace-path-store.js', () => ({
  resolveWorkspacePath: vi.fn((wsId: string) => Promise.resolve(`workspaces/${wsId}`)),
  registerWorkspacePath: vi.fn(),
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeFileRead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('テキストファイル（.py）の内容が取得できる', async () => {
      const mockResponse = {
        path: 'scripts/analysis.py',
        type: 'file',
        content: 'import pandas as pd\nprint("hello")\n',
        modified_at: '2026-04-05T10:00:00Z',
      };

      vi.mocked(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).mockResolvedValue(mockResponse);

      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'scripts/analysis.py',
      });

      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).toHaveBeenCalledWith('workspaces/ws-abc123/scripts/analysis.py');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('import pandas as pd');
      expect(result.content[0].text).toContain('analysis.py');
    });

    test('SQLファイル（.sql）の内容が取得できる', async () => {
      const mockResponse = {
        path: 'queries/select_users.sql',
        type: 'file',
        content: 'SELECT * FROM users WHERE active = true;',
        modified_at: '2026-04-05T10:00:00Z',
      };

      vi.mocked(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).mockResolvedValue(mockResponse);

      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'queries/select_users.sql',
      });

      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).toHaveBeenCalledWith('workspaces/ws-abc123/queries/select_users.sql');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('SELECT * FROM users');
    });

    test('Markdownファイル（.md）の内容が取得できる', async () => {
      const mockResponse = {
        path: 'README.md',
        type: 'file',
        content: '# Analysis Report\n\nThis is a report.\n',
        modified_at: '2026-04-05T10:00:00Z',
      };

      vi.mocked(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).mockResolvedValue(mockResponse);

      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'README.md',
      });

      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).toHaveBeenCalledWith('workspaces/ws-abc123/README.md');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('# Analysis Report');
    });

    test('サブディレクトリ内のファイルが取得できる（例: data/queries/001_query.sql）', async () => {
      const mockResponse = {
        path: 'data/queries/001_query.sql',
        type: 'file',
        content: 'SELECT count(*) FROM orders;',
        modified_at: '2026-04-05T10:00:00Z',
      };

      vi.mocked(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).mockResolvedValue(mockResponse);

      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'data/queries/001_query.sql',
      });

      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).toHaveBeenCalledWith('workspaces/ws-abc123/data/queries/001_query.sql');
      expect(result.content[0].text).toContain('"success": true');
      expect(result.content[0].text).toContain('SELECT count(*)');
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeFileRead({ file_path: 'scripts/analysis.py' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).not.toHaveBeenCalled();
    });

    test('file_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeFileRead({ workspace_id: 'ws-abc123' });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('file_path');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).not.toHaveBeenCalled();
    });

    test('パストラバーサル攻撃（../を含むパス） => VALIDATION_ERROR', async () => {
      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: '../../../etc/passwd',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).not.toHaveBeenCalled();
    });

    test('.ipynb ファイル指定 => VALIDATION_ERROR', async () => {
      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'analysis.ipynb',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('VALIDATION_ERROR');
      expect(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('ファイルが存在しない => NOT_FOUND エラー', async () => {
      const error = new Error('NOT_FOUND');
      (error as Record<string, unknown>).code = 'NOT_FOUND';
      (error as Record<string, unknown>).statusCode = 404;
      vi.mocked(
        (jupyterClient as unknown as { getTextFileContent: typeof vi.fn }).getTextFileContent,
      ).mockRejectedValue(error);

      const result = await executeFileRead({
        workspace_id: 'ws-abc123',
        file_path: 'nonexistent.py',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('NOT_FOUND');
    });
  });
});
