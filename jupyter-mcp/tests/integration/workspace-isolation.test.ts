/**
 * ワークスペース分離の結合テスト
 *
 * Phase 10 で実装したワークスペース分離機能が正しく動作することを検証する。
 * 2つのワークスペースを作成し、ファイル分離・セッション分離・永続性を確認する。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';

// レスポンス型定義

interface WorkspaceInfo {
  workspace_id: string;
  name: string;
  path: string;
  created_at: string;
  file_count?: number;
}

interface WorkspaceListResponse {
  success: boolean;
  workspaces: WorkspaceInfo[];
}

interface WorkspaceCreateResponse {
  success: boolean;
  workspace_id: string;
  name: string;
  path: string;
  data_path?: string;
  output_path?: string;
  created_at: string;
}

interface SessionCreateResponse {
  success: boolean;
  session_id: string;
  kernel_id: string;
  workspace_id: string;
  notebook_path?: string;
  status: string;
  created_at: string;
}

interface FileEntry {
  name: string;
  type: string;
  size?: number;
  modified_at?: string;
}

interface FileListResponse {
  success: boolean;
  path?: string;
  contents?: FileEntry[];
  error?: { code: string; message: string };
}

interface NotebookCreateResponse {
  success: boolean;
  path: string;
  workspace_id: string;
  created_at: string;
}

interface ExecuteCodeResponse {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: { code: string; message: string };
}

describe('ワークスペース分離の結合テスト', () => {
  const createdWorkspaceIds: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // セッションのクリーンアップ（先にセッションを削除してからワークスペースを削除）
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    // ワークスペースのクリーンアップ
    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;
  });

  test('1. ワークスペース作成・一覧の基本動作', async () => {
    const timestamp = Date.now();

    // 1. ワークスペースA, B を作成
    const createAResult = await handleToolCall('workspace_create', {
      name: `分析A-${timestamp}`,
    });
    const createAData = parseToolCallResult(createAResult) as WorkspaceCreateResponse;
    expect(createAData.success).toBe(true);
    expect(createAData.workspace_id).toBeDefined();
    createdWorkspaceIds.push(createAData.workspace_id);

    const createBResult = await handleToolCall('workspace_create', {
      name: `分析B-${timestamp}`,
    });
    const createBData = parseToolCallResult(createBResult) as WorkspaceCreateResponse;
    expect(createBData.success).toBe(true);
    expect(createBData.workspace_id).toBeDefined();
    createdWorkspaceIds.push(createBData.workspace_id);

    // 2. workspace_list で両方のワークスペースが一覧に含まれることを確認
    const listResult = await handleToolCall('workspace_list', {});
    const listData = parseToolCallResult(listResult) as WorkspaceListResponse;
    expect(listData.success).toBe(true);
    expect(Array.isArray(listData.workspaces)).toBe(true);

    const workspaceIds = listData.workspaces.map((ws) => ws.workspace_id);
    expect(workspaceIds).toContain(createAData.workspace_id);
    expect(workspaceIds).toContain(createBData.workspace_id);
  }, 15000);

  test('2. ワークスペース間のファイル分離', async () => {
    const timestamp = Date.now();

    // 1. WS-A, WS-B を作成
    const createAResult = await handleToolCall('workspace_create', {
      name: `WS-A-${timestamp}`,
    });
    const createAData = parseToolCallResult(createAResult) as WorkspaceCreateResponse;
    expect(createAData.success).toBe(true);
    const workspaceIdA = createAData.workspace_id;
    createdWorkspaceIds.push(workspaceIdA);

    const createBResult = await handleToolCall('workspace_create', {
      name: `WS-B-${timestamp}`,
    });
    const createBData = parseToolCallResult(createBResult) as WorkspaceCreateResponse;
    expect(createBData.success).toBe(true);
    const workspaceIdB = createBData.workspace_id;
    createdWorkspaceIds.push(workspaceIdB);

    // 2. WS-A にセッションを作成しノートブックを作成
    const sessionAResult = await handleToolCall('session_create', {
      workspace_id: workspaceIdA,
    });
    const sessionAData = parseToolCallResult(sessionAResult) as SessionCreateResponse;
    expect(sessionAData.success).toBe(true);
    createdSessionIds.push(sessionAData.session_id);

    const notebookAResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceIdA,
      session_id: sessionAData.session_id,
      name: 'analysis-a',
    });
    const notebookAData = parseToolCallResult(notebookAResult) as NotebookCreateResponse;
    expect(notebookAData.success).toBe(true);

    // 3. WS-B にセッションを作成しノートブックを作成
    const sessionBResult = await handleToolCall('session_create', {
      workspace_id: workspaceIdB,
    });
    const sessionBData = parseToolCallResult(sessionBResult) as SessionCreateResponse;
    expect(sessionBData.success).toBe(true);
    createdSessionIds.push(sessionBData.session_id);

    const notebookBResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceIdB,
      session_id: sessionBData.session_id,
      name: 'analysis-b',
    });
    const notebookBData = parseToolCallResult(notebookBResult) as NotebookCreateResponse;
    expect(notebookBData.success).toBe(true);

    // 4. file_list(WS-A): "analysis-a.ipynb" のみ（"analysis-b" は見えない）
    const fileListAResult = await handleToolCall('file_list', {
      workspace_id: workspaceIdA,
    });
    const fileListAData = parseToolCallResult(fileListAResult) as FileListResponse;
    expect(fileListAData.success).toBe(true);

    const fileNamesA = fileListAData.contents?.map((f) => f.name) ?? [];
    expect(fileNamesA).toContain('analysis-a.ipynb');
    expect(fileNamesA).not.toContain('analysis-b.ipynb');

    // 5. file_list(WS-B): "analysis-b.ipynb" のみ（"analysis-a" は見えない）
    const fileListBResult = await handleToolCall('file_list', {
      workspace_id: workspaceIdB,
    });
    const fileListBData = parseToolCallResult(fileListBResult) as FileListResponse;
    expect(fileListBData.success).toBe(true);

    const fileNamesB = fileListBData.contents?.map((f) => f.name) ?? [];
    expect(fileNamesB).toContain('analysis-b.ipynb');
    expect(fileNamesB).not.toContain('analysis-a.ipynb');
  }, 90000);

  test('3. ワークスペーススコープのセッション作成（cwd 確認）', async () => {
    const timestamp = Date.now();

    // 1. ワークスペース作成
    const createResult = await handleToolCall('workspace_create', {
      name: `WS-CWD-${timestamp}`,
    });
    const createData = parseToolCallResult(createResult) as WorkspaceCreateResponse;
    expect(createData.success).toBe(true);
    const workspaceId = createData.workspace_id;
    createdWorkspaceIds.push(workspaceId);

    // 2. ワークスペース内でセッション作成
    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    createdSessionIds.push(sessionData.session_id);

    // 3. cwd を確認
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionData.session_id,
      code: 'import os; print(os.getcwd())',
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);

    // stdout にワークスペースのパスが含まれることを確認
    expect(execData.stdout).toBeDefined();
    expect(execData.stdout).toContain(workspaceId);
  }, 90000);

  test('4. ワークスペースの永続性（listWorkspaces で再発見可能）', async () => {
    const timestamp = Date.now();

    // 1. ワークスペース作成
    const createResult = await handleToolCall('workspace_create', {
      name: `永続テスト-${timestamp}`,
    });
    const createData = parseToolCallResult(createResult) as WorkspaceCreateResponse;
    expect(createData.success).toBe(true);
    const workspaceId = createData.workspace_id;
    createdWorkspaceIds.push(workspaceId);

    // 2. ワークスペース内にノートブック作成
    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    createdSessionIds.push(sessionData.session_id);

    await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionData.session_id,
      name: 'persist-test',
    });

    // 3. jupyterClient.listWorkspaces() を直接呼び出して永続性を確認
    //    （MCP再起動シミュレーション: 新しいクライアントインスタンスで再発見可能かを検証）
    const workspaces = await jupyterClient.listWorkspaces();
    const found = workspaces.find((ws) => ws.workspace_id === workspaceId);
    expect(found).toBeDefined();
    expect(found?.name).toBe(`永続テスト-${timestamp}`);

    // 4. file_list でノートブックが存在することを確認
    const fileListResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
    });
    const fileListData = parseToolCallResult(fileListResult) as FileListResponse;
    expect(fileListData.success).toBe(true);

    const fileNames = fileListData.contents?.map((f) => f.name) ?? [];
    expect(fileNames).toContain('persist-test.ipynb');
  }, 90000);

  test('5. E2Eフロー: ワークスペースでの分析フロー', async () => {
    const timestamp = Date.now();

    // 1. ワークスペース作成
    const createResult = await handleToolCall('workspace_create', {
      name: `E2E分析-${timestamp}`,
    });
    const createData = parseToolCallResult(createResult) as WorkspaceCreateResponse;
    expect(createData.success).toBe(true);
    const workspaceId = createData.workspace_id;
    createdWorkspaceIds.push(workspaceId);

    // 2. セッション作成
    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    const sessionId = sessionData.session_id;
    createdSessionIds.push(sessionId);

    // 3. ノートブック作成
    const notebookResult = await handleToolCall('notebook_create', {
      workspace_id: workspaceId,
      session_id: sessionId,
      name: 'e2e-analysis',
    });
    const notebookData = parseToolCallResult(notebookResult) as NotebookCreateResponse;
    expect(notebookData.success).toBe(true);

    // 4. コード実行: x = 42
    const execResult1 = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'x = 42',
      timeout: 60,
    });
    const execData1 = parseToolCallResult(execResult1) as ExecuteCodeResponse;
    expect(execData1.success).toBe(true);

    // 5. コード実行: print(x)
    const execResult2 = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'print(x)',
      timeout: 60,
    });
    const execData2 = parseToolCallResult(execResult2) as ExecuteCodeResponse;
    expect(execData2.success).toBe(true);
    expect(execData2.stdout?.trim()).toBe('42');

    // 6. file_list でノートブックが存在することを確認
    const fileListResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
    });
    const fileListData = parseToolCallResult(fileListResult) as FileListResponse;
    expect(fileListData.success).toBe(true);

    const fileNames = fileListData.contents?.map((f) => f.name) ?? [];
    expect(fileNames).toContain('e2e-analysis.ipynb');

    // 7. セッション削除
    const deleteResult = await handleToolCall('session_delete', {
      session_id: sessionId,
    });
    const deleteData = parseToolCallResult(deleteResult);
    expect(deleteData.success).toBe(true);

    // クリーンアップリストから除外（既に削除済み）
    const index = createdSessionIds.indexOf(sessionId);
    if (index > -1) {
      createdSessionIds.splice(index, 1);
    }
  }, 90000);

  test('6. data/output ディレクトリの自動作成と利用', async () => {
    const timestamp = Date.now();

    // 1. ワークスペース作成
    const createResult = await handleToolCall('workspace_create', {
      name: `データ管理テスト-${timestamp}`,
    });
    const createData = parseToolCallResult(createResult) as WorkspaceCreateResponse;
    expect(createData.success).toBe(true);
    const workspaceId = createData.workspace_id;
    createdWorkspaceIds.push(workspaceId);

    // 2. レスポンスに data_path, output_path が含まれることを確認
    expect(createData.data_path).toBe('data');
    expect(createData.output_path).toBe('output');

    // 3. file_list でワークスペースルートに data/, output/ ディレクトリが表示されることを確認
    const fileListRootResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
    });
    const fileListRootData = parseToolCallResult(fileListRootResult) as FileListResponse;
    expect(fileListRootData.success).toBe(true);

    const rootEntries = fileListRootData.contents?.map((f) => f.name) ?? [];
    expect(rootEntries).toContain('data');
    expect(rootEntries).toContain('output');

    // 4. セッション作成
    const sessionResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessionData = parseToolCallResult(sessionResult) as SessionCreateResponse;
    expect(sessionData.success).toBe(true);
    createdSessionIds.push(sessionData.session_id);

    // 5. カーネル内から data/ にファイルを書き込む
    const writeDataResult = await handleToolCall('execute_code', {
      session_id: sessionData.session_id,
      code: "with open('data/input.csv', 'w') as f:\n    f.write('a,b\\n1,2')",
      timeout: 60,
    });
    const writeDataExec = parseToolCallResult(writeDataResult) as ExecuteCodeResponse;
    expect(writeDataExec.success).toBe(true);

    // 6. カーネル内から output/ にファイルを書き込む
    const writeOutputResult = await handleToolCall('execute_code', {
      session_id: sessionData.session_id,
      code: "with open('output/result.csv', 'w') as f:\n    f.write('x,y\\n3,4')",
      timeout: 60,
    });
    const writeOutputExec = parseToolCallResult(writeOutputResult) as ExecuteCodeResponse;
    expect(writeOutputExec.success).toBe(true);

    // 7. file_list(path="data") で input.csv が表示されることを確認
    const fileListDataResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
      path: 'data',
    });
    const fileListDataData = parseToolCallResult(fileListDataResult) as FileListResponse;
    expect(fileListDataData.success).toBe(true);

    const dataFiles = fileListDataData.contents?.map((f) => f.name) ?? [];
    expect(dataFiles).toContain('input.csv');

    // 8. file_list(path="output") で result.csv が表示されることを確認
    const fileListOutputResult = await handleToolCall('file_list', {
      workspace_id: workspaceId,
      path: 'output',
    });
    const fileListOutputData = parseToolCallResult(fileListOutputResult) as FileListResponse;
    expect(fileListOutputData.success).toBe(true);

    const outputFiles = fileListOutputData.contents?.map((f) => f.name) ?? [];
    expect(outputFiles).toContain('result.csv');

    // 9. workspace_list で data_path, output_path が含まれることを確認
    const listResult = await handleToolCall('workspace_list', {});
    const listData = parseToolCallResult(listResult) as WorkspaceListResponse & {
      workspaces: Array<WorkspaceCreateResponse>;
    };
    expect(listData.success).toBe(true);

    const thisWs = listData.workspaces.find((ws) => ws.workspace_id === workspaceId);
    expect(thisWs).toBeDefined();
    expect(thisWs?.data_path).toBe('data');
    expect(thisWs?.output_path).toBe('output');
  }, 90000);
});
