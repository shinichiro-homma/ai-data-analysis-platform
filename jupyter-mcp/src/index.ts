#!/usr/bin/env node

/**
 * jupyter-mcp: MCP server for Jupyter notebook operations
 *
 * Entry point for the MCP server.
 */

import { runMcpServer } from '@ai-data-analysis/mcp-shared';
import { registerTools, handleToolCall } from './tools/index.js';

runMcpServer({ name: 'jupyter-mcp', version: '1.0.0' }, { registerTools, handleToolCall }).catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown fatal error';
  // stderr に直接出力（logger も stdio を使うため、致命的エラー時は直接出力が安全）
  console.error('Fatal error:', message);
  process.exit(1);
});
