/**
 * MCP サーバーのファクトリ関数とエントリポイント
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger.js';

/**
 * ツールモジュールのインターフェース
 */
export interface ToolModule {
  registerTools: () => Tool[];
  handleToolCall: (
    name: string,
    args: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各 MCP 固有のレスポンス型を許容
  ) => Promise<any>;
}

/**
 * MCP サーバー設定
 */
export interface McpServerConfig {
  name: string;
  version: string;
}

/**
 * MCP サーバーを生成する
 */
export function createMcpServer(config: McpServerConfig, toolModule: ToolModule): Server {
  const server = new Server(
    {
      name: config.name,
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ツール一覧
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: toolModule.registerTools() };
  });

  // ツール実行
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return toolModule.handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return server;
}

/**
 * MCP サーバーを起動する（stdio トランスポート）
 */
export async function runMcpServer(config: McpServerConfig, toolModule: ToolModule): Promise<void> {
  const server = createMcpServer(config, toolModule);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`${config.name} server running on stdio`);
}
