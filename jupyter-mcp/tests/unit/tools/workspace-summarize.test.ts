import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeWorkspaceSummarize } from '../../../src/tools/workspace-summarize.js';
import type { WorkspaceSummarizeResponse } from '../../../src/jupyter-client/types.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    summarizeWorkspace: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeWorkspaceSummarize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockResponse: WorkspaceSummarizeResponse = {
    workspace_id: 'ws-a1b2c3d4',
    template: '# 検証結果サマリー\n...',
    verification_criteria: '# 検証観点 A-F\n...',
    instructions: '以下の手順でサマリーを作成してください:\n1. ...',
  };

  describe('正常系', () => {
    test('workspace_id を指定してテンプレートが返却される', async () => {
      vi.mocked(jupyterClient.summarizeWorkspace).mockResolvedValue(mockResponse);

      const result = await executeWorkspaceSummarize({
        workspace_id: 'ws-a1b2c3d4',
      });

      expect(jupyterClient.summarizeWorkspace).toHaveBeenCalledWith('ws-a1b2c3d4');
      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(true);
      expect(parsed.workspace_id).toBe('ws-a1b2c3d4');
      expect(parsed.template).toContain('検証結果サマリー');
      expect(parsed.verification_criteria).toContain('検証観点');
      expect(parsed.instructions).toBeDefined();
    });
  });

  describe('バリデーションエラー', () => {
    test('workspace_id 未指定 => エラー', async () => {
      const result = await executeWorkspaceSummarize({});

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('workspace_id');
      expect(jupyterClient.summarizeWorkspace).not.toHaveBeenCalled();
    });

    test('不正な workspace_id（パストラバーサル） => エラー', async () => {
      const result = await executeWorkspaceSummarize({
        workspace_id: '../etc/passwd',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(jupyterClient.summarizeWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('API エラー', () => {
    test('存在しない workspace_id => NOT_FOUND', async () => {
      const error = Object.assign(new Error('Workspace not found'), { code: 'NOT_FOUND' });
      vi.mocked(jupyterClient.summarizeWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceSummarize({
        workspace_id: 'ws-nonexistent',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('NOT_FOUND');
    });

    test('接続エラー => エラーレスポンス', async () => {
      const error = new Error('Connection refused');
      vi.mocked(jupyterClient.summarizeWorkspace).mockRejectedValue(error);

      const result = await executeWorkspaceSummarize({
        workspace_id: 'ws-a1b2c3d4',
      });

      expect(result.content[0].text).toContain('"success": false');
      expect(result.content[0].text).toContain('Connection refused');
    });
  });
});
