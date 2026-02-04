/**
 * MCP サーバー定義
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerTools, handleToolCall } from "./tools/index.js";
import { listResources, readResource } from "./resources/images.js";

export function createServer(): Server {
  const server = new Server(
    {
      name: "jupyter-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
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

  // リソース一覧
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return listResources();
  });

  // リソース読み取り
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return readResource(request.params.uri);
  });

  return server;
}
