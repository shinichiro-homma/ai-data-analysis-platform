/**
 * session_connect ツールの結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';

// Jupyter Sessions API を使ってセッションを直接作成（ブラウザで開いた状態をシミュレート）
// NOTE: axios ではなく fetch を使用。axios のエラーオブジェクトには関数プロパティ
// (transformRequest等) が含まれ、vitest の RPC シリアライズ (structured clone) で
// DataCloneError を引き起こすため。
async function createJupyterSession(notebookPath: string, kernelName = 'python3') {
  const baseUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
  const token = process.env.JUPYTER_TOKEN ?? '';

  const response = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      path: notebookPath,
      name: notebookPath,
      type: 'notebook',
      kernel: {
        name: kernelName,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to create Jupyter session: ${response.status} ${response.statusText} - ${body}`);
  }

  return response.json();
}

// Jupyter Sessions API を使ってセッションを削除
async function deleteJupyterSession(sessionId: string) {
  const baseUrl = process.env.JUPYTER_SERVER_URL ?? 'http://localhost:8888';
  const token = process.env.JUPYTER_TOKEN ?? '';

  try {
    await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    // セッションが既に削除されている場合は無視
    console.warn(`Session ${sessionId} deletion failed (may already be deleted)`);
  }
}

describe('session_connect の結合テスト', () => {
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

  /** テスト用ワークスペース+セッション+ノートブックを作成するヘルパー */
  async function createTestNotebook(
    testName: string,
    notebookName: string,
  ): Promise<{ workspaceId: string; sessionId: string; notebookPath: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-connect-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessData = parseToolCallResult(sessResult);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    const nbResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionId,
      name: notebookName,
    });
    const nbData = parseToolCallResult(nbResult);
    const notebookPath = nbData.path as string;

    return { workspaceId, sessionId, notebookPath };
  }

  test('notebook_path でブラウザのセッションに接続できる', async () => {
    // 1. ワークスペース内にノートブックを作成
    const { notebookPath } = await createTestNotebook('nb-path', 'test-connect');

    // 2. Jupyter Sessions API で直接セッションを作成（ブラウザで開いた状態をシミュレート）
    const session = await createJupyterSession(notebookPath);
    expect(session.id).toBeDefined();
    expect(session.kernel.id).toBeDefined();
    createdSessionIds.push(session.id);

    // 3. session_connect(notebook_path) で接続
    const connectResult = await handleToolCall('session_connect', {
      notebook_path: notebookPath,
    });

    // 4. 接続成功、kernel_id が返ることを確認
    const connectData = parseToolCallResult(connectResult);
    expect(connectData.success).toBe(true);
    expect(connectData.session_id).toBe(session.id);
    expect(connectData.kernel_id).toBe(session.kernel.id);
    expect(connectData.status).toBeDefined();
    expect(connectData.connected).toBe(true);
  });

  test('先頭に / があるパスでも接続できる', async () => {
    // 1. ワークスペース内にノートブックを作成
    const { notebookPath } = await createTestNotebook('slash', 'test-slash');

    // 2. セッション作成
    const session = await createJupyterSession(notebookPath);
    createdSessionIds.push(session.id);

    // 3. session_connect に先頭 / 付きパスで接続
    const connectResult = await handleToolCall('session_connect', {
      notebook_path: `/${notebookPath}`,
    });

    // 4. 接続成功を確認
    const connectData = parseToolCallResult(connectResult);
    expect(connectData.success).toBe(true);
    expect(connectData.kernel_id).toBe(session.kernel.id);
  });

  test('kernel_id でセッションに接続できる', async () => {
    // 1. ワークスペース内にノートブックを作成
    const { notebookPath } = await createTestNotebook('kernel-id', 'test-kernel-id');

    // 2. セッションを作成
    const session = await createJupyterSession(notebookPath);
    createdSessionIds.push(session.id);

    // 3. session_connect(kernel_id) で接続
    const connectResult = await handleToolCall('session_connect', {
      kernel_id: session.kernel.id,
    });

    // 4. 接続成功、notebook_path が返ることを確認
    const connectData = parseToolCallResult(connectResult);
    expect(connectData.success).toBe(true);
    expect(connectData.session_id).toBe(session.id);
    expect(connectData.kernel_id).toBe(session.kernel.id);
    expect(connectData.connected).toBe(true);
  });

  describe('エラーケース', () => {
    test('存在しない notebook_path でエラーが返る', async () => {
      const connectResult = await handleToolCall('session_connect', {
        notebook_path: 'non-existent.ipynb',
      });

      const connectData = parseToolCallResult(connectResult);
      expect(connectData.success).toBe(false);
      expect(connectData.error).toBeDefined();

      const error = connectData.error as { code?: string; message?: string };
      expect(error.code).toBe('SESSION_NOT_FOUND');
      expect(error.message).toContain('non-existent.ipynb');
    });

    test('存在しない kernel_id でエラーが返る', async () => {
      const fakeKernelId = 'non-existent-kernel-id-12345';

      const connectResult = await handleToolCall('session_connect', {
        kernel_id: fakeKernelId,
      });

      const connectData = parseToolCallResult(connectResult);
      expect(connectData.success).toBe(false);
      expect(connectData.error).toBeDefined();

      const error = connectData.error as { code?: string; message?: string };
      expect(error.code).toBe('SESSION_NOT_FOUND');
      expect(error.message).toContain(fakeKernelId);
    });

    test('notebook_path も kernel_id も指定しないとエラーが返る', async () => {
      const connectResult = await handleToolCall('session_connect', {});

      const connectData = parseToolCallResult(connectResult);
      expect(connectData.success).toBe(false);
      expect(connectData.error).toBeDefined();

      const error = connectData.error as { code?: string; message?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toContain('notebook_path または kernel_id');
    });

    test('不正な長さの notebook_path でエラーが返る', async () => {
      const longPath = 'a'.repeat(501); // maxLength: 500 を超える

      const connectResult = await handleToolCall('session_connect', {
        notebook_path: longPath,
      });

      const connectData = parseToolCallResult(connectResult);
      expect(connectData.success).toBe(false);
      expect(connectData.error).toBeDefined();

      const error = connectData.error as { code?: string; message?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    test('不正な長さの kernel_id でエラーが返る', async () => {
      const longKernelId = 'k'.repeat(101); // maxLength: 100 を超える

      const connectResult = await handleToolCall('session_connect', {
        kernel_id: longKernelId,
      });

      const connectData = parseToolCallResult(connectResult);
      expect(connectData.success).toBe(false);
      expect(connectData.error).toBeDefined();

      const error = connectData.error as { code?: string; message?: string };
      expect(error.code).toBe('VALIDATION_ERROR');
    });
  });
});
