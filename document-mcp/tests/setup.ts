/**
 * テスト用ヘルパー
 */

/**
 * MCPツール実行結果のレスポンス型
 */
export interface ToolCallResponse {
  success: boolean;
  [key: string]: unknown;
}

/**
 * MCPツール実行結果をパースして型安全に取得
 */
export function parseToolCallResult(result: { content: Array<{ type: string; text: string }> }): ToolCallResponse {
  return JSON.parse(result.content[0].text) as ToolCallResponse;
}
