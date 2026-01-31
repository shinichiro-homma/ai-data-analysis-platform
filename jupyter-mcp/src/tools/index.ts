/**
 * MCP ツールの登録とルーティング
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { executeNotebookCreate } from "./notebook-create.js";

/**
 * ツール定義
 */
const tools: Tool[] = [
  {
    name: "notebook_create",
    description: "新しいノートブックを作成します",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "ノートブック名（拡張子 .ipynb は不要）",
        },
        path: {
          type: "string",
          description: "保存先ディレクトリパス（省略時はルートディレクトリ '/'）",
        },
      },
      required: ["name"],
    },
  },
];

/**
 * ツール一覧を返す
 */
export function registerTools(): Tool[] {
  return tools;
}

/**
 * ツール名から実装関数へルーティング
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case "notebook_create":
      return executeNotebookCreate(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
