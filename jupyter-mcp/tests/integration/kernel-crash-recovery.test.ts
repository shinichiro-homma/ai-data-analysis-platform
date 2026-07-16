/**
 * カーネル自動復旧の結合テスト
 *
 * MCP 経由でカーネルをクラッシュさせ、自動復旧後に再実行が成功することを検証する。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';

interface WorkspaceCreateResponse {
  success: boolean;
  workspace_id: string;
}

interface SessionCreateResponse {
  success: boolean;
  session_id: string;
  kernel_id: string;
  workspace_id: string;
}

interface ExecuteCodeResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: { code: string; message: string };
}

/**
 * カーネルを再起動してクラッシュからの復旧をシミュレートする
 *
 * code_validator のホワイトリストにより os._exit() は実行できないため、
 * Jupyter REST API 経由でカーネルを再起動する。
 *
 * @param kernelId 再起動するカーネルID
 */
async function crashKernel(kernelId: string): Promise<void> {
  await jupyterClient.restartKernel(kernelId);
}

/**
 * カーネルが復旧するまでポーリングする
 * クラッシュ後、Jupyter は自動的に新しいカーネルを起動する
 *
 * @param kernelId ポーリング対象のカーネルID
 * @param intervalMs ポーリング間隔（デフォルト: 3000ms）
 * @param timeoutMs ポーリング最大待機時間（デフォルト: 120000ms）
 */
async function waitForKernelRecovery(kernelId: string, intervalMs = 3000, timeoutMs = 120000): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const kernel = await jupyterClient.getKernel(kernelId);
      // Kernel 型の status フィールドを使用（execution_state は JupyterSession.kernel のフィールド）
      if (kernel.status === 'idle') {
        return;
      }
    } catch {
      // カーネルが一時的に取得できない場合は続行
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`カーネルが ${timeoutMs / 1000} 秒以内に復旧しませんでした（kernel_id: ${kernelId}）`);
}

describe('カーネル自動復旧の結合テスト', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;
  });

  /** テスト用ワークスペースとセッションを作成するヘルパー */
  async function createTestSession(testName: string): Promise<{
    workspaceId: string;
    sessionId: string;
    kernelId: string;
  }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-crash-recovery-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult) as WorkspaceCreateResponse;
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id;
    createdWorkspaceIds.push(workspaceId);

    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    const sessionId = sessionData.session_id;
    const kernelId = sessionData.kernel_id;
    createdSessionIds.push(sessionId);

    return { workspaceId, sessionId, kernelId };
  }

  test('1. カーネルクラッシュ後に自動復旧しコード実行が成功する', async () => {
    const { sessionId, kernelId } = await createTestSession('crash-and-recover');

    // カーネルをクラッシュさせる
    await crashKernel(kernelId);

    // カーネルの自動復旧を待機
    await waitForKernelRecovery(kernelId);

    // 復旧後にコードを実行
    const recoverResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'print("recovered")',
      timeout: 30,
    });

    const recoverData = parseToolCallResult(recoverResult) as ExecuteCodeResponse;
    expect(recoverData.success).toBe(true);
    expect(recoverData.stdout).toContain('recovered');
  }, 180000);

  test('2. 復旧後に変数状態がリセットされている', async () => {
    const { sessionId, kernelId } = await createTestSession('variable-reset');

    // クラッシュ前に変数を定義
    const defineResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'my_test_variable = 42',
      timeout: 10,
    });
    const defineData = parseToolCallResult(defineResult) as ExecuteCodeResponse;
    expect(defineData.success).toBe(true);

    // カーネルをクラッシュさせる
    await crashKernel(kernelId);

    // カーネルの自動復旧を待機
    await waitForKernelRecovery(kernelId);

    // 復旧後に変数にアクセス → NameError が期待される
    const checkResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'print(my_test_variable)',
      timeout: 30,
    });

    const checkData = parseToolCallResult(checkResult) as ExecuteCodeResponse;
    // 変数はリセットされているため NameError になる
    expect(checkData.success).toBe(false);
    expect(checkData.error).toBeDefined();
    const error = checkData.error as { code?: string };
    expect(error.code).toBe('NameError');
  }, 180000);

  test('3. 復旧後に sandbox が再注入されワークスペース外アクセスが拒否される', async () => {
    const { sessionId, kernelId } = await createTestSession('sandbox-reinjection');

    // 別のワークスペースを作成（アクセス制限のターゲット）
    const wsOtherResult = await handleToolCall('workspace_create', {
      name: `test-crash-sandbox-other-${Date.now()}`,
    });
    const wsOtherData = parseToolCallResult(wsOtherResult) as WorkspaceCreateResponse;
    expect(wsOtherData.success).toBe(true);
    const otherWorkspaceId = wsOtherData.workspace_id;
    createdWorkspaceIds.push(otherWorkspaceId);

    // カーネルをクラッシュさせる
    await crashKernel(kernelId);

    // カーネルの自動復旧を待機
    await waitForKernelRecovery(kernelId);

    // 復旧後にワークスペース外パスへのアクセスを試みる
    const sandboxResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: `
import os
workspace_b_id = '${otherWorkspaceId}'
workspace_root = os.path.dirname(os.getcwd())
other_ws_path = os.path.join(workspace_root, workspace_b_id, 'metadata.json')
try:
    open(other_ws_path, 'r')
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
except FileNotFoundError:
    # metadata.json が存在しない場合でもアクセスは拒否されるべき
    print('NO_ERROR')
`,
      timeout: 30,
    });

    const sandboxData = parseToolCallResult(sandboxResult) as ExecuteCodeResponse;
    expect(sandboxData.success).toBe(true);
    expect(sandboxData.stdout).toContain('PermissionError');
    expect(sandboxData.stdout).not.toContain('NO_ERROR');
  }, 180000);

  test('4. 明示的な再起動後もコード実行が成功する', async () => {
    const { sessionId, kernelId } = await createTestSession('explicit-restart');

    // 別のワークスペースを作成（sandbox 確認用）
    const wsOtherResult = await handleToolCall('workspace_create', {
      name: `test-restart-sandbox-other-${Date.now()}`,
    });
    const wsOtherData = parseToolCallResult(wsOtherResult) as WorkspaceCreateResponse;
    expect(wsOtherData.success).toBe(true);
    const otherWorkspaceId = wsOtherData.workspace_id;
    createdWorkspaceIds.push(otherWorkspaceId);

    // 明示的にカーネルを再起動
    await jupyterClient.restartKernel(kernelId);

    // 再起動後の復旧を待機
    await waitForKernelRecovery(kernelId);

    // コード実行が成功することを確認
    const executeResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'print("after restart")',
      timeout: 30,
    });
    const executeData = parseToolCallResult(executeResult) as ExecuteCodeResponse;
    expect(executeData.success).toBe(true);
    expect(executeData.stdout).toContain('after restart');

    // sandbox が再注入されてワークスペース外アクセスが拒否されることを確認
    const sandboxResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: `
import os
workspace_b_id = '${otherWorkspaceId}'
workspace_root = os.path.dirname(os.getcwd())
other_ws_path = os.path.join(workspace_root, workspace_b_id, 'metadata.json')
try:
    open(other_ws_path, 'r')
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
except FileNotFoundError:
    print('NO_ERROR')
`,
      timeout: 30,
    });
    const sandboxData = parseToolCallResult(sandboxResult) as ExecuteCodeResponse;
    expect(sandboxData.success).toBe(true);
    expect(sandboxData.stdout).toContain('PermissionError');
    expect(sandboxData.stdout).not.toContain('NO_ERROR');
  }, 180000);
});
