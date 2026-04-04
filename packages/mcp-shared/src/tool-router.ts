/**
 * MCP ツールのレジストリ・ルーティング（共通）
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createErrorResponse, createErrorResponseFromError, type McpResponse } from './response-formatter.js';

/**
 * ツール定義と実装関数を一元管理するレジストリエントリ
 *
 * TResult のデフォルトは McpResponse だが、
 * 画像コンテンツ等を含む拡張レスポンス型も指定可能。
 */
export interface ToolEntry<TResult = McpResponse> {
  definition: Tool;
  execute: (args: Record<string, unknown>) => Promise<TResult>;
}

/**
 * レジストリからツール定義一覧を返す
 */
export function registerTools(registry: ToolEntry<unknown>[]): Tool[] {
  return registry.map((entry) => entry.definition);
}

/**
 * ツール名から実装関数へルーティングし実行する
 */
export async function handleToolCall<TResult>(
  registry: ToolEntry<TResult>[],
  name: string,
  args: Record<string, unknown>,
): Promise<TResult | McpResponse> {
  const entry = registry.find((e) => e.definition.name === name);
  if (!entry) {
    const safeName = typeof name === 'string' ? name.slice(0, 100) : 'unknown';
    return createErrorResponse(`Unknown tool: ${safeName}`, 'UNKNOWN_TOOL');
  }
  try {
    return await entry.execute(args);
  } catch (error) {
    return createErrorResponseFromError(error);
  }
}
