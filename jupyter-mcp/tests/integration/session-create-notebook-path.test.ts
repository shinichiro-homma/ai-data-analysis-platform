/**
 * session_create ツールの notebook_path 対応の結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import {
  checkJupyterConnection,
  parseToolCallResult,
  cleanupSession,
} from '../setup.js';
import axios from 'axios';

// Jupyter Sessions API を使ってセッションを削除
async function deleteJupyterSession(sessionId: string) {
  const baseUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
  const token = process.env.JUPYTER_TOKEN ?? '';

  try {
    await axios.delete(`${baseUrl}/api/sessions/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    // セッションが既に削除されている場合は無視
    console.warn(`Session ${sessionId} deletion failed (may already be deleted)`);
  }
}

describe('session_create の notebook_path 対応の結合テスト', () => {
  // テストで作成したセッションIDを保持（クリーンアップ用）
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const sessionId of createdSessionIds) {
      await deleteJupyterSession(sessionId);
    }
    createdSessionIds.length = 0;
  });

  test('notebook_path 指定でセッションが作成される', async () => {
    // 1. ノートブックパスを指定してセッション作成
    const notebookPath = 'test_session_create.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.session_id).toBeDefined();
    expect(data.kernel_id).toBeDefined();
    expect(data.notebook_path).toBe(notebookPath);
    expect(data.status).toBeDefined();

    createdSessionIds.push(data.session_id);

    // 2. セッション一覧で確認
    const sessions = await jupyterClient.listSessions();
    const session = sessions.find((s) => s.id === data.session_id);

    expect(session).toBeDefined();
    expect(session!.path).toBe(notebookPath);
    expect(session!.kernel.id).toBe(data.kernel_id);
  });

  test('作成したセッションに session_connect で接続できる', async () => {
    // 1. notebook_path 指定でセッション作成
    const notebookPath = 'test_connect_to_created.ipynb';
    const createResult = await handleToolCall('session_create', {
      notebook_path: notebookPath,
    });

    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);
    createdSessionIds.push(createData.session_id);

    const originalKernelId = createData.kernel_id;

    // 2. session_connect で同じノートブックに接続
    const connectResult = await handleToolCall('session_connect', {
      notebook_path: notebookPath,
    });

    const connectData = parseToolCallResult(connectResult);
    expect(connectData.success).toBe(true);
    expect(connectData.kernel_id).toBe(originalKernelId);
    expect(connectData.notebook_path).toBe(notebookPath);
  });

  test('notebook_path なしの従来動作（カーネルのみ作成）', async () => {
    // notebook_path を指定せずにセッション作成
    const result = await handleToolCall('session_create', {});

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.session_id).toBeDefined();
    expect(data.kernel_id).toBeDefined();
    expect(data.notebook_path).toBeUndefined(); // notebook_path は存在しない
    expect(data.status).toBeDefined();

    // セッションIDがカーネルIDと同じ形式の場合（カーネルのみ）
    // クリーンアップはカーネルとして削除
    await cleanupSession(data.session_id);
  });

  test('異常系: 空文字のnotebook_path', async () => {
    const result = await handleToolCall('session_create', {
      notebook_path: '',
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('notebook_path');
  });

  test('異常系: 長すぎるnotebook_path', async () => {
    const longPath = 'a'.repeat(501) + '.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: longPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('notebook_path');
  });

  test('パス正規化: 先頭のスラッシュが正しく処理される', async () => {
    // 先頭にスラッシュを付けて作成
    const notebookPath = '/test_slash.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    // 正規化されて先頭のスラッシュが除去される
    expect(data.notebook_path).toBe('test_slash.ipynb');

    createdSessionIds.push(data.session_id);
  });

  test('サブディレクトリのパスが正しく処理される', async () => {
    const notebookPath = 'data/analysis.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.notebook_path).toBe(notebookPath);

    createdSessionIds.push(data.session_id);
  });

  test('セキュリティ: パストラバーサル攻撃を防ぐ', async () => {
    const maliciousPath = '../../../etc/passwd.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: maliciousPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('..');
  });

  test('セキュリティ: NULLバイト攻撃を防ぐ', async () => {
    const maliciousPath = 'test\0.ipynb';
    const result = await handleToolCall('session_create', {
      notebook_path: maliciousPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('不正な文字');
  });
});
