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
 * テスト用 MCP クライアント接続を作成
 *
 * InMemoryTransport を使用してクライアント-サーバー間の接続を確立する。
 *
 * @returns MCP クライアント接続オブジェクト
 *
 * @example
 * const { client, cleanup } = await createMcpClient();
 * try {
 *   const result = await client.callTool('session_create', { name: 'python3' });
 *   // ...
 * } finally {
 *   await cleanup();
 * }
 */
export async function createMcpClient(): Promise<McpClientConnection> {
  // サーバーインスタンス作成
  const server = createServer();

  // InMemoryTransport のペアを作成
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

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

  // クリーンアップ関数
  const cleanup = async () => {
    await client.close();
    await server.close();
  };

  return { client, cleanup };
}
