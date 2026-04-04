#!/usr/bin/env node

/**
 * document-mcp: MCP server for data catalog and glossary operations
 *
 * Entry point for the MCP server.
 */

import { runMcpServer } from '@ai-data-analysis/mcp-shared';
import { registerTools, handleToolCall } from './tools/index.js';

runMcpServer({ name: 'document-mcp', version: '1.0.0' }, { registerTools, handleToolCall }).catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown fatal error';
  console.error('Fatal error:', message);
  process.exit(1);
});
