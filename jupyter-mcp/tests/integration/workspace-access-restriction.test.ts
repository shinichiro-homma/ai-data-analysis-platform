/**
 * ワークスペース間アクセス制限の結合テスト
 *
 * session_create 時にカーネルへ注入されるサンドボックスコードが
 * ワークスペースディレクトリ外へのファイルアクセスを正しく拒否することを検証する。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';

interface WorkspaceCreateResponse {
  success: boolean;
  workspace_id: string;
  name: string;
  path: string;
  created_at: string;
}

interface SessionCreateResponse {
  success: boolean;
  session_id: string;
  kernel_id: string;
  workspace_id: string;
  status: string;
  created_at: string;
}

interface ExecuteCodeResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: { code: string; message: string };
}

describe('ワークスペース間アクセス制限の結合テスト', () => {
  const createdWorkspaceIds: string[] = [];
  const createdSessionIds: string[] = [];

  let workspaceIdA: string;
  let workspaceIdB: string;
  let sessionIdA: string;

  beforeAll(async () => {
    await checkJupyterConnection();

    const timestamp = Date.now();

    // ワークスペース A を作成
    const createAResult = await handleToolCall('workspace_create', {
      name: `アクセス制限テストA-${timestamp}`,
    });
    const createAData = parseToolCallResult(createAResult) as WorkspaceCreateResponse;
    expect(createAData.success).toBe(true);
    workspaceIdA = createAData.workspace_id;
    createdWorkspaceIds.push(workspaceIdA);

    // ワークスペース B を作成（アクセス制限のターゲット）
    const createBResult = await handleToolCall('workspace_create', {
      name: `アクセス制限テストB-${timestamp}`,
    });
    const createBData = parseToolCallResult(createBResult) as WorkspaceCreateResponse;
    expect(createBData.success).toBe(true);
    workspaceIdB = createBData.workspace_id;
    createdWorkspaceIds.push(workspaceIdB);

    // ワークスペース A にセッションを作成（サンドボックスが注入される）
    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceIdA,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    sessionIdA = sessionData.session_id;
    createdSessionIds.push(sessionIdA);
  }, 60000);

  afterAll(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
  });

  test('1. ワークスペース外ファイルの読み取りが PermissionError になる', async () => {
    const code = `
import os
workspace_b_id = '${workspaceIdB}'
workspace_root = os.path.dirname(os.getcwd())
other_ws_path = os.path.join(workspace_root, workspace_b_id, 'metadata.json')
try:
    open(other_ws_path, 'r')
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
except FileNotFoundError:
    # metadata.json が存在する場合でもアクセスは拒否されるべき
    print('NO_ERROR')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout).toContain('PermissionError');
    expect(data.stdout).not.toContain('NO_ERROR');
  }, 30000);

  test('2. ワークスペース外への os.chdir() が PermissionError になる', async () => {
    const code = `
import os
workspace_b_id = '${workspaceIdB}'
workspace_root = os.path.dirname(os.getcwd())
other_ws_path = os.path.join(workspace_root, workspace_b_id)
try:
    os.chdir(other_ws_path)
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout).toContain('PermissionError');
    expect(data.stdout).not.toContain('NO_ERROR');
  }, 30000);

  test('3. ワークスペース内ファイルの読み書きは成功する', async () => {
    const code = `
from pathlib import Path
with open('sandbox_test.txt', 'w') as f:
    f.write('hello sandbox')
with open('sandbox_test.txt', 'r') as f:
    content = f.read()
print(content)
Path('sandbox_test.txt').unlink()
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout?.trim()).toBe('hello sandbox');
  }, 30000);

  test('4. ワークスペース内サブディレクトリへの os.chdir() は成功する', async () => {
    const code = `
import os
original_cwd = os.getcwd()
os.chdir('data')
new_cwd = os.getcwd()
os.chdir(original_cwd)
print('OK' if 'data' in new_cwd else 'FAIL')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout?.trim()).toBe('OK');
  }, 30000);

  test('5. /tmp/ws-{workspace_id} へのファイル書き込みは成功する（ホワイトリスト）', async () => {
    const tmpFile = `/tmp/ws-${workspaceIdA}/sandbox_test_${Date.now()}.txt`;
    const code = `
from pathlib import Path
tmp_file = '${tmpFile}'
try:
    with open(tmp_file, 'w') as f:
        f.write('tmp ok')
    with open(tmp_file, 'r') as f:
        content = f.read()
    Path(tmp_file).unlink()
    print('OK' if content == 'tmp ok' else 'FAIL')
except PermissionError as e:
    print(f'PermissionError: {e}')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout?.trim()).toBe('OK');
  }, 30000);

  test('6. 相対パスでのワークスペース間アクセスが PermissionError になる', async () => {
    const code = `
try:
    open('../${workspaceIdB}/metadata.json', 'r')
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
except FileNotFoundError:
    print('NO_ERROR')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout).toContain('PermissionError');
    expect(data.stdout).not.toContain('NO_ERROR');
  }, 30000);

  test('7. pathlib.Path でのワークスペース外アクセスが PermissionError になる', async () => {
    const code = `
from pathlib import Path
import os
workspace_b_id = '${workspaceIdB}'
workspace_root = os.path.dirname(os.getcwd())
other_ws_path = os.path.join(workspace_root, workspace_b_id, 'metadata.json')
try:
    Path(other_ws_path).read_text()
    print('NO_ERROR')
except PermissionError as e:
    print(f'PermissionError: {e}')
except FileNotFoundError:
    print('NO_ERROR')
`;
    const result = await handleToolCall('execute_code', {
      session_id: sessionIdA,
      code,
      timeout: 30,
    });
    const data = parseToolCallResult(result) as ExecuteCodeResponse;
    expect(data.success).toBe(true);
    expect(data.stdout).toContain('PermissionError');
    expect(data.stdout).not.toContain('NO_ERROR');
  }, 30000);
});
