/**
 * notebook_add_cell ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";

/**
 * ノートブックにセルを追加する
 */
export async function executeNotebookAddCell(
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // 引数の検証
  const notebookPath = args.notebook_path as string | undefined;
  const cellType = args.cell_type as "code" | "markdown" | undefined;
  const source = args.source as string | undefined;
  const position = args.position as number | undefined;

  // 必須パラメータの検証
  if (!notebookPath || typeof notebookPath !== "string") {
    return createErrorResponse(
      "notebook_path パラメータは必須です",
      "VALIDATION_ERROR"
    );
  }

  if (!cellType || (cellType !== "code" && cellType !== "markdown")) {
    return createErrorResponse(
      "cell_type パラメータは必須で、'code' または 'markdown' である必要があります",
      "VALIDATION_ERROR"
    );
  }

  if (!source || typeof source !== "string") {
    return createErrorResponse(
      "source パラメータは必須です",
      "VALIDATION_ERROR"
    );
  }

  // position が指定された場合の検証
  if (position !== undefined && (typeof position !== "number" || position < 0)) {
    return createErrorResponse(
      "position パラメータは 0 以上の数値である必要があります",
      "VALIDATION_ERROR"
    );
  }

  try {
    // セルを追加
    await jupyterClient.operateCell(notebookPath, {
      action: "add",
      cell: {
        cell_type: cellType,
        source: source,
      },
      index: position, // undefined の場合は末尾に追加
    });

    const positionMessage =
      position !== undefined
        ? `位置 ${position} に`
        : "末尾に";

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              notebook_path: notebookPath,
              cell_type: cellType,
              position: position,
              message: `ノートブック "${notebookPath}" の${positionMessage}${cellType} セルを追加しました`,
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
