/**
 * MCP ツールの登録とルーティング
 */

import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { executeNotebookCreate } from "./notebook-create.js";
import { executeNotebookAddCell } from "./notebook-add-cell.js";
import { executeSessionCreate } from "./session-create.js";
import { executeSessionList } from "./session-list.js";
import { executeSessionDelete } from "./session-delete.js";
import { executeSessionConnect } from "./session-connect.js";
import { executeExecuteCode } from "./execute-code.js";
import { executeGetVariables } from "./get-variables.js";

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
  {
    name: "session_create",
    description: "新しいデータ分析セッションを作成します。コード実行前に必ず呼び出してください。",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "カーネル名（デフォルト: python3）",
        },
        notebook_path: {
          type: "string",
          description: "関連付けるノートブックのパス。指定するとユーザーがそのノートブックを開いたときに同じカーネルを共有できる",
        },
      },
      required: [],
    },
  },
  {
    name: "session_list",
    description: "アクティブな分析セッションの一覧を取得します。",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "session_delete",
    description: "分析セッションを終了し、リソースを解放します。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "終了するセッションID",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "session_connect",
    description: "既存のセッション（ブラウザで開いているノートブック）に接続します。ユーザーが既にJupyterLabでノートブックを開いて作業中の場合に、同じカーネル（セッション）に接続して変数を共有できます。",
    inputSchema: {
      type: "object",
      properties: {
        notebook_path: {
          type: "string",
          description: "接続したいノートブックのパス（例: analysis.ipynb）",
        },
        kernel_id: {
          type: "string",
          description: "接続したいカーネルのID。notebook_path の代わりに指定可能",
        },
      },
      required: [],
    },
  },
  {
    name: "execute_code",
    description: "Pythonコードを実行し、結果を返します。事前にsession_createでセッションを作成してください。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "セッションID",
        },
        code: {
          type: "string",
          description: "実行するPythonコード",
        },
        timeout: {
          type: "number",
          description: "タイムアウト秒数（デフォルト30秒、最大300秒）",
        },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_variables",
    description: "セッション内で定義されている変数の一覧を取得します。変数名、型、サイズ（概算）を返します。",
    inputSchema: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "セッションID",
        },
      },
      required: ["session_id"],
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
    case "session_create":
      return executeSessionCreate(args);
    case "session_list":
      return executeSessionList(args);
    case "session_delete":
      return executeSessionDelete(args);
    case "session_connect":
      return executeSessionConnect(args);
    case "execute_code":
      return executeExecuteCode(args);
    case "get_variables":
      return executeGetVariables(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
