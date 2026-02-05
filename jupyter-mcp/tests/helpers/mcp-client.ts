/**
 * テスト用 MCP クライアントヘルパー
 *
 * @modelcontextprotocol/sdk の Client と InMemoryTransport を使用して、
 * テスト環境でサーバーと接続するためのヘルパー関数を提供する。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

/**
 * MCP クライアント接続
 */
export interface McpClientConnection {
  client: Client;
  cleanup: () => Promise<void>;
}

/**
 * MCP ツール呼び出し結果のレスポンス型
 */
export interface McpToolCallResponse {
  success: boolean;
  [key: string]: unknown;
}

/**
 * テスト用 MCP クライアント接続を作成
 *
 * InMemoryTransport を使用してクライアント-サーバー間の接続を確立する。
 *
 * @returns MCP クライアント接続オブジェクト
 *
 * @example
 * const { client, cleanup } = await createMcpClient();
 * try {
 *   const result = await client.callTool({
 *     name: 'session_create',
 *     arguments: { name: 'python3' }
 *   });
 *   // ...
 * } finally {
 *   await cleanup();
 * }
 */
export async function createMcpClient(): Promise<McpClientConnection> {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  let isConnected = false;

  try {
    // サーバーを接続
    await server.connect(serverTransport);

    // クライアントを作成して接続
    const client = new Client(
      {
        name: "test-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );

    await client.connect(clientTransport);
    isConnected = true;

    // クリーンアップ関数
    const cleanup = async () => {
      await client.close();
      await server.close();
    };

    return { client, cleanup };
  } catch (error) {
    // 接続失敗時のクリーンアップ
    if (isConnected) {
      await server.close();
    }
    throw error;
  }
}

/**
 * MCP ツール呼び出し結果をパースして型安全に取得
 *
 * @param result - MCP ツール呼び出し結果
 * @returns パースされた JSON オブジェクト
 */
export function parseMcpToolCallResult(result: {
  content: Array<{ type: string; text: string | unknown }>;
}): McpToolCallResponse {
  return JSON.parse(result.content[0].text as string) as McpToolCallResponse;
}
