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
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';
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
  const createdWorkspaceIds: string[] = [];

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

    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;
  });

  /** テスト用ワークスペースを作成するヘルパー */
  async function createTestWorkspace(testName: string): Promise<string> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-nbpath-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);
    return workspaceId;
  }

  test('notebook_path 指定でセッションが作成される', async () => {
    const workspaceId = await createTestWorkspace('create');

    // 1. ノートブックパスを指定してセッション作成
    const notebookPath = 'test_session_create.ipynb';
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.session_id).toBeDefined();
    expect(data.kernel_id).toBeDefined();
    // notebook_path はワークスペースプレフィックス付きで返る
    const returnedPath = data.notebook_path as string;
    expect(returnedPath).toContain(notebookPath);
    expect(returnedPath).toContain(workspaceId);
    expect(data.status).toBeDefined();

    createdSessionIds.push(data.session_id as string);

    // 2. セッション一覧で確認
    const sessions = await jupyterClient.listSessions();
    const session = sessions.find((s) => s.id === data.session_id);

    expect(session).toBeDefined();
    expect(session!.kernel.id).toBe(data.kernel_id);
  });

  test('作成したセッションに session_connect で接続できる', async () => {
    const workspaceId = await createTestWorkspace('connect');

    // 1. notebook_path 指定でセッション作成
    const notebookPath = 'test_connect_to_created.ipynb';
    const createResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookPath,
    });

    const createData = parseToolCallResult(createResult);
    expect(createData.success).toBe(true);
    createdSessionIds.push(createData.session_id as string);

    const originalKernelId = createData.kernel_id;
    // サーバーから返されたフルパスで接続する
    const fullNotebookPath = createData.notebook_path as string;

    // 2. session_connect でフルパスを使って接続
    const connectResult = await handleToolCall('session_connect', {
      notebook_path: fullNotebookPath,
    });

    const connectData = parseToolCallResult(connectResult);
    expect(connectData.success).toBe(true);
    expect(connectData.kernel_id).toBe(originalKernelId);
  });

  test('notebook_path なしの従来動作（カーネルのみ作成）', async () => {
    const workspaceId = await createTestWorkspace('no-path');

    // notebook_path を指定せずにセッション作成（workspace_id のみ）
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    expect(data.session_id).toBeDefined();
    expect(data.kernel_id).toBeDefined();
    expect(data.status).toBeDefined();

    // クリーンアップ
    await cleanupSession(data.session_id as string);
  });

  test('異常系: 空文字のnotebook_path', async () => {
    const workspaceId = await createTestWorkspace('empty-path');

    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: '',
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('パスが空です');
  });

  test('異常系: 長すぎるnotebook_path', async () => {
    const workspaceId = await createTestWorkspace('long-path');
    const longPath = 'a'.repeat(501) + '.ipynb';

    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: longPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('パスが長すぎます');
  });

  test('パス正規化: 先頭のスラッシュが正しく処理される', async () => {
    const workspaceId = await createTestWorkspace('slash');

    // 先頭にスラッシュを付けて作成
    const notebookPath = '/test_slash.ipynb';
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    // ワークスペースプレフィックス付きで返る。ファイル名部分を確認
    const returnedPath = data.notebook_path as string;
    expect(returnedPath).toContain('test_slash.ipynb');
    expect(returnedPath).toContain(workspaceId);

    createdSessionIds.push(data.session_id as string);
  });

  test('サブディレクトリのパスが正しく処理される', async () => {
    const workspaceId = await createTestWorkspace('subdir');

    const notebookPath = 'data/analysis.ipynb';
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(true);
    // ワークスペースプレフィックス付きで返る
    const returnedPath = data.notebook_path as string;
    expect(returnedPath).toContain(notebookPath);
    expect(returnedPath).toContain(workspaceId);

    createdSessionIds.push(data.session_id as string);
  });

  test('セキュリティ: パストラバーサル攻撃を防ぐ', async () => {
    const workspaceId = await createTestWorkspace('traversal');

    const maliciousPath = '../../../etc/passwd.ipynb';
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: maliciousPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('..');
  });

  test('セキュリティ: NULLバイト攻撃を防ぐ', async () => {
    const workspaceId = await createTestWorkspace('nullbyte');

    const maliciousPath = 'test\0.ipynb';
    const result = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: maliciousPath,
    });

    const data = parseToolCallResult(result);
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
    const errorObj = data.error as { code: string; message: string };
    expect(errorObj.message).toContain('不正な文字');
  });
});
