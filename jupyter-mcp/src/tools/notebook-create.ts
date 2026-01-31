/**
 * notebook_create ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";

/**
 * 新しいノートブックを作成する
 */
export async function executeNotebookCreate(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // 引数の検証
  const name = args.name as string | undefined;
  const path = (args.path as string | undefined) ?? "/";

  if (!name || typeof name !== "string") {
    return createErrorResponse("name パラメータは必須です", "VALIDATION_ERROR");
  }

  try {
    // ノートブック名の処理（.ipynb 拡張子を追加）
    const notebookName = name.endsWith(".ipynb") ? name : `${name}.ipynb`;

    // 完全なパスを構築
    const normalizedPath = path.endsWith("/") ? path : `${path}/`;
    const fullPath = normalizedPath === "/" ? notebookName : `${normalizedPath}${notebookName}`;

    // ノートブックを作成
    const result = await jupyterClient.createNotebook(fullPath);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              path: result.path,
              created_at: result.created_at,
              message: `ノートブック "${notebookName}" を作成しました`,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    // エラーハンドリング
    const message = error instanceof Error ? error.message : "Unknown error";
    const code = "code" in (error as any) ? (error as any).code : "INTERNAL_ERROR";

    return createErrorResponse(message, code);
  }
}

/**
 * エラーレスポンスを生成
 */
function createErrorResponse(
  message: string,
  code: string
): { content: Array<{ type: string; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: false,
            error: {
              code,
              message,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}
