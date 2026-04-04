/**
 * MCP サーバー定義
 */

import { createMcpServer } from '@ai-data-analysis/mcp-shared';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerTools, handleToolCall } from './tools/index.js';

export function createServer(): Server {
  return createMcpServer({ name: 'jupyter-mcp', version: '1.0.0' }, { registerTools, handleToolCall });
}
