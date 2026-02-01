/**
 * MCP ツールの登録とルーティング
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { executeNotebookCreate } from "./notebook-create.js";
import { executeNotebookAddCell } from "./notebook-add-cell.js";

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
  {
    name: "notebook_add_cell",
    description: "ノートブックにセル（code または markdown）を追加します",
    inputSchema: {
      type: "object",
      properties: {
        notebook_path: {
          type: "string",
          description: "ノートブックのパス（例: analysis.ipynb）",
        },
        cell_type: {
          type: "string",
          enum: ["code", "markdown"],
          description: "セルの種類（code または markdown）",
        },
        source: {
          type: "string",
          description: "セルの内容",
        },
        position: {
          type: "number",
          description: "挿入位置（0-indexed、省略時は末尾に追加）",
        },
      },
      required: ["notebook_path", "cell_type", "source"],
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
    case "notebook_add_cell":
      return executeNotebookAddCell(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
