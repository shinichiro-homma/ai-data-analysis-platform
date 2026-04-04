/**
 * 画像ファイル永続化の結合テスト
 *
 * Phase 18 で変更した画像ファイル永続化機能の結合テスト。
 * ワークスペースを使ったファイルシステム永続化の検証に特化する。
 *
 * 既存テスト（execute-code-images.test.ts）でカバー済みの検証：
 * - file_path/mime_type/description の返却形式
 * - base64 データが含まれないこと
 * - description 連番
 *
 * 本テストでカバーする検証：
 * - file_list で output/ に画像ファイルが実際に保存されていること
 * - 複数回実行でファイル名が衝突しないこと
 * - 複数グラフ実行で全ファイルが output/ に存在すること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import { checkJupyterConnection, parseToolCallResult, cleanupSession, cleanupWorkspace } from '../setup.js';

interface ImageReference {
  file_path: string;
  mime_type: string;
  description: string;
}

interface ExecuteCodeResponse {
  success: boolean;
  result: string;
  images: ImageReference[];
  [key: string]: unknown;
}

interface FileEntry {
  name: string;
  type: string;
  path: string;
}

interface FileListResponse {
  success: boolean;
  contents: FileEntry[];
  [key: string]: unknown;
}

interface WorkspaceCreateResponse {
  success: boolean;
  workspace_id: string;
  data_path: string;
  output_path: string;
  [key: string]: unknown;
}

interface SessionCreateResponse {
  success: boolean;
  session_id: string;
  kernel_id: string;
  [key: string]: unknown;
}

const MATPLOTLIB_SINGLE_PLOT = `
import matplotlib.pyplot as plt
plt.figure(figsize=(8, 6))
plt.plot([1, 2, 3], [4, 5, 6])
plt.title('Test Plot')
plt.show()
`.trim();

const MATPLOTLIB_TWO_PLOTS = `
import matplotlib.pyplot as plt

plt.figure(figsize=(8, 6))
plt.plot([1, 2, 3], [4, 5, 6])
plt.title('Plot A')
plt.show()

plt.figure(figsize=(8, 6))
plt.bar([1, 2, 3], [7, 8, 9])
plt.title('Plot B')
plt.show()
`.trim();

describe('画像ファイル永続化の結合テスト', () => {
  const timestamp = Date.now();
  const createdWorkspaceIds: string[] = [];
  const createdSessionIds: string[] = [];

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

  /** ワークスペースとセッションを作成するヘルパー */
  async function createWorkspaceAndSession(testName: string) {
    // ワークスペース作成
    const wsResult = await handleToolCall('workspace_create', {
      name: `img-persist-${testName}-${timestamp}`,
    });
    const wsData = parseToolCallResult(wsResult) as WorkspaceCreateResponse;
    expect(wsData.success).toBe(true);
    createdWorkspaceIds.push(wsData.workspace_id);

    // セッション作成（notebook_path 付きでワークスペース解決を有効にする）
    const sessResult = await handleToolCall('session_create', {
      workspace_id: wsData.workspace_id,
      notebook_path: 'analysis.ipynb',
    });
    const sessData = parseToolCallResult(sessResult) as SessionCreateResponse;
    expect(sessData.success).toBe(true);
    createdSessionIds.push(sessData.session_id);

    return { workspaceId: wsData.workspace_id, sessionId: sessData.session_id };
  }

  /** file_list で output/ のファイル名一覧を取得するヘルパー */
  async function getOutputFileNames(workspaceId: string): Promise<string[]> {
    const result = await handleToolCall('file_list', {
      workspace_id: workspaceId,
      path: 'output',
    });
    const data = parseToolCallResult(result) as FileListResponse;
    return data.contents?.map((f) => f.name) ?? [];
  }

  /** file_path からファイル名部分を抽出するヘルパー */
  function extractFileName(filePath: string): string {
    return filePath.split('/').pop() ?? '';
  }

  test('1. グラフ描画後、file_list で output/ に画像ファイルが存在する', async () => {
    const { workspaceId, sessionId } = await createWorkspaceAndSession('file-exist');

    // matplotlib でグラフを描画
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_SINGLE_PLOT,
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);
    expect(execData.images.length).toBeGreaterThanOrEqual(1);

    const image = execData.images[0];

    // file_path に workspace_id が含まれることを検証
    expect(image.file_path).toContain(workspaceId);

    // file_list で output/ のファイルを取得
    const outputFiles = await getOutputFileNames(workspaceId);

    // レスポンスの file_path のファイル名が file_list の結果に含まれることを検証
    const fileName = extractFileName(image.file_path);
    expect(outputFiles).toContain(fileName);
  }, 60000);

  test('2. 複数回実行でファイル名が衝突しない（execution_count 増加）', async () => {
    const { workspaceId, sessionId } = await createWorkspaceAndSession('no-collision');

    // 1回目のグラフ描画
    const exec1Result = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_SINGLE_PLOT,
      timeout: 60,
    });
    const exec1Data = parseToolCallResult(exec1Result) as ExecuteCodeResponse;
    expect(exec1Data.success).toBe(true);
    expect(exec1Data.images.length).toBeGreaterThanOrEqual(1);

    const fileName1 = extractFileName(exec1Data.images[0].file_path);

    // 2回目のグラフ描画
    const exec2Result = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_SINGLE_PLOT,
      timeout: 60,
    });
    const exec2Data = parseToolCallResult(exec2Result) as ExecuteCodeResponse;
    expect(exec2Data.success).toBe(true);
    expect(exec2Data.images.length).toBeGreaterThanOrEqual(1);

    const fileName2 = extractFileName(exec2Data.images[0].file_path);

    // ファイル名が異なることを検証（execution_count が異なる）
    expect(fileName1).not.toBe(fileName2);

    // exec-N の N が異なることを検証
    const execNum1 = fileName1.match(/exec-(\d+)/)?.[1];
    const execNum2 = fileName2.match(/exec-(\d+)/)?.[1];
    expect(execNum1).toBeDefined();
    expect(execNum2).toBeDefined();
    expect(execNum1).not.toBe(execNum2);

    // file_list で 2 つのファイルが両方存在することを検証
    const outputFiles = await getOutputFileNames(workspaceId);
    expect(outputFiles).toContain(fileName1);
    expect(outputFiles).toContain(fileName2);
  }, 90000);

  test('3. 複数グラフ描画で全ファイルが output/ に存在する', async () => {
    const { workspaceId, sessionId } = await createWorkspaceAndSession('multi-graph');

    // 1回の execute_code で 2 つのグラフを描画
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_TWO_PLOTS,
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);
    expect(execData.images.length).toBeGreaterThanOrEqual(2);

    // 各ファイル名が異なることを検証
    const fileNames = execData.images.map((img) => extractFileName(img.file_path));
    const uniqueNames = new Set(fileNames);
    expect(uniqueNames.size).toBe(fileNames.length);

    // file_list で全ファイルが output/ に存在することを検証
    const outputFiles = await getOutputFileNames(workspaceId);
    for (const fileName of fileNames) {
      expect(outputFiles).toContain(fileName);
    }
  }, 60000);
});
