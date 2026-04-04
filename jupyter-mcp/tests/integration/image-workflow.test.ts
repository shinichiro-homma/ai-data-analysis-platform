/**
 * 画像ワークフロー結合テスト
 *
 * execute_code → get_image の一連フローを検証する。
 * 既存テストでカバー済みの個別機能（execute_code の images 返却、
 * get_image のユニットテスト、画像ファイル永続化）は重複しない。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import type { McpToolResult } from '../../src/utils/response-formatter.js';
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

const MATPLOTLIB_SINGLE_PLOT = `
import matplotlib.pyplot as plt
plt.figure(figsize=(8, 6))
plt.plot([1, 2, 3, 4], [1, 4, 2, 3])
plt.title('Workflow Test Plot')
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

describe('画像ワークフロー結合テスト (execute_code → get_image)', () => {
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
  async function createWorkspaceAndSession(testName: string): Promise<{
    workspaceId: string;
    sessionId: string;
  }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `img-wf-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
    });
    const sessData = parseToolCallResult(sessResult);
    expect(sessData.success).toBe(true);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    return { workspaceId, sessionId };
  }

  test('1. グラフ描画 → get_image の完全フロー', async () => {
    const { sessionId } = await createWorkspaceAndSession('full-flow');

    // execute_code で matplotlib グラフを描画
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_SINGLE_PLOT,
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);
    expect(execData.images).toBeDefined();
    expect(execData.images.length).toBeGreaterThanOrEqual(1);

    const image = execData.images[0];
    expect(image.file_path).toMatch(/^workspaces\/.+\/output\/exec-\d+-img-\d+\.\w+$/);
    expect(image.mime_type).toBe('image/png');
    expect(image.description).toBeDefined();

    // get_image で画像を取得
    const getImageResult = (await handleToolCall('get_image', {
      file_path: image.file_path,
    })) as McpToolResult;

    // MCP image content type で返却されることを検証
    expect(getImageResult.isError).toBeUndefined();
    expect(getImageResult.content).toHaveLength(1);

    const content = getImageResult.content[0];
    expect(content.type).toBe('image');
    expect(content.mimeType).toBe('image/png');
    expect(content.data).toBeDefined();
    // PNG ヘッダ（base64）で始まることを検証
    expect(content.data!.startsWith('iVBORw0KGgo')).toBe(true);
  }, 60000);

  test('2. execute_code のレスポンスに base64 データが含まれない', async () => {
    const { sessionId } = await createWorkspaceAndSession('no-base64');

    // execute_code で matplotlib グラフを描画
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_SINGLE_PLOT,
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);
    expect(execData.images.length).toBeGreaterThanOrEqual(1);

    // images 配列の各要素に base64 データキーが含まれないことを検証
    for (const image of execData.images) {
      expect(image).toHaveProperty('file_path');
      expect(image).toHaveProperty('mime_type');
      expect(image).toHaveProperty('description');
      // base64 データに関連するキーが存在しないこと
      expect(image).not.toHaveProperty('data');
      expect(image).not.toHaveProperty('content');
      expect(image).not.toHaveProperty('base64');
    }

    // レスポンス全体を文字列化して、長大な base64 文字列が含まれていないことも検証
    const responseStr = JSON.stringify(execData);
    // PNG base64 ヘッダが含まれていないこと（get_image 経由でないと取得できない）
    expect(responseStr).not.toContain('iVBORw0KGgo');
  }, 60000);

  test('3. 複数画像の描画 → 各画像を get_image で取得', async () => {
    const { sessionId } = await createWorkspaceAndSession('multi-img');

    // execute_code で複数の matplotlib グラフを描画
    const execResult = await handleToolCall('execute_code', {
      session_id: sessionId,
      code: MATPLOTLIB_TWO_PLOTS,
      timeout: 60,
    });
    const execData = parseToolCallResult(execResult) as ExecuteCodeResponse;
    expect(execData.success).toBe(true);
    expect(execData.images.length).toBeGreaterThanOrEqual(2);

    // 各 file_path に対して get_image を呼び出し、全て MCP image content type で取得できることを検証
    for (const image of execData.images) {
      const getImageResult = (await handleToolCall('get_image', {
        file_path: image.file_path,
      })) as McpToolResult;

      expect(getImageResult.isError).toBeUndefined();
      expect(getImageResult.content).toHaveLength(1);
      expect(getImageResult.content[0].type).toBe('image');
      expect(getImageResult.content[0].mimeType).toBe('image/png');
      expect(getImageResult.content[0].data).toBeDefined();
      expect(getImageResult.content[0].data!.length).toBeGreaterThan(0);
    }
  }, 60000);

  test('4. get_image に存在しないパスを指定 → エラー', async () => {
    const getImageResult = (await handleToolCall('get_image', {
      file_path: 'workspaces/ws-nonexistent/output/fake.png',
    })) as McpToolResult;

    expect(getImageResult.isError).toBe(true);
    expect(getImageResult.content).toHaveLength(1);
    expect(getImageResult.content[0].type).toBe('text');

    const parsed = JSON.parse(getImageResult.content[0].text!);
    expect(parsed.success).toBe(false);
  });

  test('5. get_image に不正なパス（workspaces/ 外）を指定 → バリデーションエラー', async () => {
    const getImageResult = (await handleToolCall('get_image', {
      file_path: '../../etc/passwd',
    })) as McpToolResult;

    expect(getImageResult.isError).toBe(true);
    expect(getImageResult.content).toHaveLength(1);
    expect(getImageResult.content[0].type).toBe('text');

    const parsed = JSON.parse(getImageResult.content[0].text!);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('VALIDATION_ERROR');
  });
});
