/**
 * 画像リソースのワークフロー結合テスト（MCP プロトコル経由）
 *
 * Phase 7 で実装した画像リソース機能の統合テストを実施する。
 * MCPプロトコル経由でグラフ描画→画像リソースURI取得→
 * 画像一覧確認→画像データ取得の一連のフローが正しく動作することを検証する。
 *
 * 既存テストとの棲み分け:
 * - execute-code-images.test.ts: execute_code の画像出力機能（handleToolCall 直接）
 * - get-image-resource.test.ts: get_image_resource ツール（handleToolCall 直接）
 * - このテスト: MCPプロトコル経由のワークフロー結合テスト
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { createMcpClient, parseMcpToolCallResult } from '../helpers/mcp-client.js';
import type { McpClientConnection, McpToolCallResponse } from '../helpers/mcp-client.js';
import { cleanupSession, checkJupyterConnection } from '../setup.js';

/**
 * MCP クライアント経由でセッションを作成するヘルパー関数
 */
async function createSession(
  client: McpClientConnection['client'],
  createdSessionIds: string[]
): Promise<string> {
  const createResult = await client.callTool({
    name: 'session_create',
    arguments: {
      name: 'python3',
    },
  });

  const createData = parseMcpToolCallResult(createResult);
  expect(createData.success).toBe(true);

  const sessionId = createData.session_id as string;
  createdSessionIds.push(sessionId);

  return sessionId;
}

describe('画像リソースのワークフローテスト（MCP プロトコル経由）', () => {
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;
  });

  describe('グラフ描画→画像取得の完全フロー', () => {
    test('execute_code → listResources → readResource → get_image_resource', async () => {
      // 1. MCP クライアント接続を作成
      const { client, cleanup } = await createMcpClient();

      try {
        // 2. session_create でセッションを作成
        const sessionId = await createSession(client, createdSessionIds);

        // 3. execute_code で matplotlib グラフを描画
        const code = `
import matplotlib.pyplot as plt
plt.figure(figsize=(8, 6))
plt.plot([1, 2, 3, 4], [1, 4, 2, 3])
plt.title('Test Plot')
plt.show()
        `.trim();

        const executeResult = await client.callTool({
          name: 'execute_code',
          arguments: {
            session_id: sessionId,
            code,
          },
        });

        const executeData = parseMcpToolCallResult(executeResult);
        expect(executeData.success).toBe(true);
        expect(executeData.images).toBeDefined();

        const images = executeData.images as Array<{
          resource_uri: string;
          mime_type: string;
          description: string;
        }>;

        expect(images).toHaveLength(1);
        const resourceUri = images[0].resource_uri;

        // 4. listResources で画像一覧を取得
        const resourcesList = await client.listResources();

        expect(resourcesList.resources).toBeDefined();
        expect(Array.isArray(resourcesList.resources)).toBe(true);

        // 生成した画像が一覧に含まれることを確認
        const foundResource = resourcesList.resources.find(
          (r) => r.uri === resourceUri
        );
        expect(foundResource).toBeDefined();
        expect(foundResource?.mimeType).toBe('image/png');

        // 5. readResource で画像データを取得
        const resourceData = await client.readResource({ uri: resourceUri });

        expect(resourceData.contents).toBeDefined();
        expect(resourceData.contents).toHaveLength(1);

        const content = resourceData.contents[0];
        expect(content.uri).toBe(resourceUri);
        expect(content.mimeType).toBe('image/png');
        expect(content.blob).toBeDefined();
        expect(typeof content.blob).toBe('string');

        // base64 PNG ヘッダの確認（iVBORw0KGgo...）
        expect(content.blob).toMatch(/^iVBORw0KGgo/);

        // 6. get_image_resource でも同じ画像を取得
        const getImageResult = await client.callTool({
          name: 'get_image_resource',
          arguments: {
            resource_uri: resourceUri,
          },
        });

        const imageData = parseMcpToolCallResult(getImageResult);
        expect(imageData.success).toBe(true);
        expect(imageData.mime_type).toBe('image/png');
        expect(imageData.data).toBeDefined();

        // resources/read と get_image_resource のデータが一致することを確認
        expect(imageData.data).toBe(content.blob);

        // 7. session_delete でクリーンアップ
        const deleteResult = await client.callTool({
          name: 'session_delete',
          arguments: {
            session_id: sessionId,
          },
        });

        const deleteData = parseMcpToolCallResult(deleteResult);
        expect(deleteData.success).toBe(true);

        // クリーンアップリストから削除（既に削除済み）
        const index = createdSessionIds.indexOf(sessionId);
        if (index > -1) {
          createdSessionIds.splice(index, 1);
        }
      } finally {
        await cleanup();
      }
    }, 30000);
  });

  describe('複数セッションでの画像分離', () => {
    test('異なるセッションの画像が適切に分離される', async () => {
      // 1. MCP クライアント接続を作成
      const { client, cleanup } = await createMcpClient();

      try {
        // 2. セッション A を作成
        const sessionIdA = await createSession(client, createdSessionIds);

        // 3. セッション B を作成
        const sessionIdB = await createSession(client, createdSessionIds);

        // 4. セッション A でグラフ 1 枚描画
        const codeA = `
import matplotlib.pyplot as plt
plt.figure()
plt.plot([1, 2, 3])
plt.title('Session A Graph')
plt.show()
        `.trim();

        const executeResultA = await client.callTool({
          name: 'execute_code',
          arguments: {
            session_id: sessionIdA,
            code: codeA,
          },
        });

        const executeDataA = JSON.parse(executeResultA.content[0].text as string);
        expect(executeDataA.success).toBe(true);
        expect(executeDataA.images).toHaveLength(1);

        const uriA = executeDataA.images[0].resource_uri as string;

        // 5. セッション B でグラフ 2 枚描画
        const codeB = `
import matplotlib.pyplot as plt

# グラフ 1
plt.figure()
plt.plot([1, 4, 2])
plt.title('Session B Graph 1')
plt.show()

# グラフ 2
plt.figure()
plt.plot([3, 1, 2])
plt.title('Session B Graph 2')
plt.show()
        `.trim();

        const executeResultB = await client.callTool({
          name: 'execute_code',
          arguments: {
            session_id: sessionIdB,
            code: codeB,
          },
        });

        const executeDataB = JSON.parse(executeResultB.content[0].text as string);
        expect(executeDataB.success).toBe(true);
        expect(executeDataB.images.length).toBeGreaterThanOrEqual(2);

        const uriBs = executeDataB.images.map((img: { resource_uri: string }) => img.resource_uri);

        // 6. listResources で全画像を取得
        const resourcesList = await client.listResources();

        expect(resourcesList.resources).toBeDefined();
        expect(resourcesList.resources.length).toBeGreaterThanOrEqual(3);

        // 各画像の resource_uri が異なるセッション ID を持つことを確認
        expect(uriA).toContain(sessionIdA);
        for (const uriB of uriBs) {
          expect(uriB).toContain(sessionIdB);
        }

        // セッション A の URI と セッション B の URI が異なることを確認
        for (const uriB of uriBs) {
          expect(uriB).not.toBe(uriA);
        }

        // 7. 各セッションをクリーンアップ
        await client.callTool({
          name: 'session_delete',
          arguments: { session_id: sessionIdA },
        });
        await client.callTool({
          name: 'session_delete',
          arguments: { session_id: sessionIdB },
        });

        createdSessionIds.length = 0;
      } finally {
        await cleanup();
      }
    }, 40000);
  });

  describe('画像フォーマット・メタデータ確認', () => {
    test('画像データが正しい形式で取得できる', async () => {
      // 1. MCP クライアント接続を作成
      const { client, cleanup } = await createMcpClient();

      try {
        // 2. セッション作成
        const sessionId = await createSession(client, createdSessionIds);

        // 3. execute_code でグラフを描画
        const code = `
import matplotlib.pyplot as plt
plt.figure(figsize=(6, 4))
plt.plot([1, 2, 3, 4], [10, 20, 15, 25])
plt.xlabel('X-axis')
plt.ylabel('Y-axis')
plt.title('Format Test Plot')
plt.show()
        `.trim();

        const executeResult = await client.callTool({
          name: 'execute_code',
          arguments: {
            session_id: sessionId,
            code,
          },
        });

        const executeData = parseMcpToolCallResult(executeResult);
        expect(executeData.success).toBe(true);
        expect(executeData.images).toHaveLength(1);

        const resourceUri = executeData.images[0].resource_uri as string;

        // 4. readResource で画像を取得
        const resourceData = await client.readResource({ uri: resourceUri });

        expect(resourceData.contents).toBeDefined();
        expect(resourceData.contents).toHaveLength(1);

        const content = resourceData.contents[0];

        // mimeType が "image/png"
        expect(content.mimeType).toBe('image/png');

        // blob が有効な base64 文字列
        expect(content.blob).toBeDefined();
        expect(typeof content.blob).toBe('string');
        expect(content.blob.length).toBeGreaterThan(0);

        // PNG ヘッダ（iVBORw0KGgo...）で始まることを確認
        expect(content.blob).toMatch(/^iVBORw0KGgo/);

        // 5. クリーンアップ
        await client.callTool({
          name: 'session_delete',
          arguments: { session_id: sessionId },
        });
        createdSessionIds.length = 0;
      } finally {
        await cleanup();
      }
    }, 30000);
  });
});
