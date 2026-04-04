/**
 * MCP ツールの登録とルーティング
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  type ToolEntry,
  registerTools as sharedRegisterTools,
  handleToolCall as sharedHandleToolCall,
  type McpResponse,
  BULK_MAX_ITEMS,
} from '@ai-data-analysis/mcp-shared';
import { executeTableIndex } from './table-index.js';
import { executeTableDetail } from './table-detail.js';
import { executeTermIndex } from './term-index.js';
import { executeTermDetail } from './term-detail.js';
import { executeLogicIndex } from './logic-index.js';
import { executeLogicDetail } from './logic-detail.js';
import { executeLogicCode } from './logic-code.js';

const toolRegistry: ToolEntry[] = [
  {
    definition: {
      name: 'get_table_index',
      description:
        'Retrieves the full table index from the data catalog. Returns a list of table names, display names, summaries, and categories. Use to determine which tables to use for analysis.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    execute: executeTableIndex,
  },
  {
    definition: {
      name: 'get_table_detail',
      description:
        'Retrieves detailed information for specified tables in bulk. Supports multiple tables at once. Returns column definitions (including key_type/key_types and domain for relation info), basic statistics (including table-specific additional stats), and table-level notes. MUST be called before writing SQL to understand table structure.',
      inputSchema: {
        type: 'object',
        properties: {
          table_names: {
            type: 'array',
            items: { type: 'string' },
            maxItems: BULK_MAX_ITEMS,
            description: 'List of table names to retrieve',
          },
        },
        required: ['table_names'],
      },
    },
    execute: executeTableDetail,
  },
  {
    definition: {
      name: 'get_term_index',
      description:
        "Retrieves the term index from the glossary. Specify query to search by term name and aliases (partial match). Call when the user's question contains unknown business terms or abbreviations.",
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keyword (returns all if omitted). Searches term names and aliases by partial match',
          },
        },
        required: [],
      },
    },
    execute: executeTermIndex,
  },
  {
    definition: {
      name: 'get_term_detail',
      description:
        'Retrieves detailed information for specified terms. Includes aliases, definition, values, etc. Supports multiple terms at once. Call after identifying relevant terms via the term index.',
      inputSchema: {
        type: 'object',
        properties: {
          term_names: {
            type: 'array',
            items: { type: 'string' },
            maxItems: BULK_MAX_ITEMS,
            description: 'List of term names to retrieve',
          },
        },
        required: ['term_names'],
      },
    },
    execute: executeTermDetail,
  },
  {
    definition: {
      name: 'get_logic_index',
      description:
        'Retrieves the full index of existing logic. Returns logic names, summaries, and categories. Call to check for reusable existing logic before writing analysis code.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    execute: executeLogicIndex,
  },
  {
    definition: {
      name: 'get_logic_detail',
      description:
        'Retrieves metadata for specified existing logic. Includes description, language, usage_type, input tables, notes, etc. Supports multiple logic at once. Does NOT include code — use get_logic_code separately.',
      inputSchema: {
        type: 'object',
        properties: {
          logic_names: {
            type: 'array',
            items: { type: 'string' },
            maxItems: BULK_MAX_ITEMS,
            description: 'List of logic names to retrieve',
          },
        },
        required: ['logic_names'],
      },
    },
    execute: executeLogicDetail,
  },
  {
    definition: {
      name: 'get_logic_code',
      description:
        'Retrieves the code file contents of the specified existing logic. Call after reviewing metadata with get_logic_detail when the actual code is needed.',
      inputSchema: {
        type: 'object',
        properties: {
          logic_name: {
            type: 'string',
            description: 'Logic name to retrieve',
          },
        },
        required: ['logic_name'],
      },
    },
    execute: executeLogicCode,
  },
];

/**
 * ツール定義一覧を返す
 */
export function registerTools(): Tool[] {
  return sharedRegisterTools(toolRegistry);
}

/**
 * ツール名から実装関数へルーティング
 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpResponse> {
  return sharedHandleToolCall(toolRegistry, name, args);
}
