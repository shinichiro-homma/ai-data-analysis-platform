/**
 * MCP サーバー定義
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerTools, handleToolCall } from "./tools/index.js";

export function createServer(): Server {
  const server = new Server(
    {
      name: "jupyter-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ツール一覧
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: registerTools() };
  });

  // ツール実行
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, request.params.arguments ?? {});
  });

  return server;
}
