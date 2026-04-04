import { describe, test, expect, vi, beforeEach } from 'vitest';
import { executeGetImage } from '../../../src/tools/get-image.js';

// jupyterClient をモック
vi.mock('../../../src/jupyter-client/client.js', () => ({
  jupyterClient: {
    getFileContent: vi.fn(),
  },
}));

import { jupyterClient } from '../../../src/jupyter-client/client.js';

describe('executeGetImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('正常系', () => {
    test('PNG画像 => MCP image content type で返却', async () => {
      vi.mocked(jupyterClient.getFileContent).mockResolvedValue({
        content: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        mimetype: 'image/png',
      });

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/exec-1-img-001.png',
      });

      expect(jupyterClient.getFileContent).toHaveBeenCalledWith('workspaces/ws-abc123/output/exec-1-img-001.png');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/png');
      expect(result.content[0].data).toBeDefined();
      expect(result.isError).toBeUndefined();
    });

    test('JPEG画像 => image/jpeg の mimeType で返却', async () => {
      vi.mocked(jupyterClient.getFileContent).mockResolvedValue({
        content: '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQ==',
        mimetype: 'image/jpeg',
      });

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/exec-1-img-001.jpg',
      });

      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/jpeg');
      expect(result.content[0].data).toBeDefined();
      expect(result.isError).toBeUndefined();
    });

    test('SVG画像（mimetype が image/svg+xml） => そのまま返却', async () => {
      vi.mocked(jupyterClient.getFileContent).mockResolvedValue({
        content: 'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==',
        mimetype: 'image/svg+xml',
      });

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/exec-1-img-001.svg',
      });

      expect(result.content[0].type).toBe('image');
      expect(result.content[0].mimeType).toBe('image/svg+xml');
      expect(result.isError).toBeUndefined();
    });

    test('mimetype が image/ 以外でも拡張子からフォールバック', async () => {
      vi.mocked(jupyterClient.getFileContent).mockResolvedValue({
        content: 'iVBORw0KGgoAAAA==',
        mimetype: 'application/octet-stream',
      });

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/exec-1-img-001.png',
      });

      expect(result.content[0].mimeType).toBe('image/png');
    });
  });

  describe('バリデーションエラー', () => {
    test('file_path 未指定 => VALIDATION_ERROR', async () => {
      const result = await executeGetImage({});

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('file_path');
      expect(result.isError).toBe(true);
      expect(jupyterClient.getFileContent).not.toHaveBeenCalled();
    });

    test('file_path 空文字 => VALIDATION_ERROR', async () => {
      const result = await executeGetImage({ file_path: '' });

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(result.isError).toBe(true);
      expect(jupyterClient.getFileContent).not.toHaveBeenCalled();
    });

    test('パストラバーサル（".." を含むパス）=> VALIDATION_ERROR', async () => {
      const result = await executeGetImage({ file_path: 'workspaces/ws-abc123/../../etc/passwd' });

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.message).toContain('..');
      expect(result.isError).toBe(true);
      expect(jupyterClient.getFileContent).not.toHaveBeenCalled();
    });

    test('ワークスペース外パス => VALIDATION_ERROR', async () => {
      const result = await executeGetImage({ file_path: 'etc/passwd' });

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(result.isError).toBe(true);
      expect(jupyterClient.getFileContent).not.toHaveBeenCalled();
    });
  });

  describe('APIエラー', () => {
    test('存在しないファイルパス => エラーレスポンス（isError: true）', async () => {
      const error = new Error('File not found: workspaces/ws-abc123/output/nonexistent.png');
      (error as any).code = 'NOT_FOUND';

      vi.mocked(jupyterClient.getFileContent).mockRejectedValue(error);

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/nonexistent.png',
      });

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('NOT_FOUND');
      expect(result.isError).toBe(true);
    });

    test('Jupyter Contents API 接続エラー => エラーレスポンス', async () => {
      const error = new Error('jupyter-server (http://localhost:8888) への接続に失敗しました');
      (error as any).code = 'CONNECTION_ERROR';

      vi.mocked(jupyterClient.getFileContent).mockRejectedValue(error);

      const result = await executeGetImage({
        file_path: 'workspaces/ws-abc123/output/exec-1-img-001.png',
      });

      const parsed = JSON.parse(result.content[0].text!);
      expect(parsed.success).toBe(false);
      expect(parsed.error.code).toBe('CONNECTION_ERROR');
      expect(result.isError).toBe(true);
    });
  });
});
