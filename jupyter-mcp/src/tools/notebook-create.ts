/**
 * notebook_create ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";

/**
 * 新しいノートブックを作成する
 */
export async function executeNotebookCreate(
  args: Record<string, unknown>
): Promise<McpResponse> {
  // 引数の検証
  const name = args.name as string | undefined;
  const path = (args.path as string | undefined) ?? "/";

  if (!name || typeof name !== "string") {
    return createErrorResponse("name パラメータは必須です", "VALIDATION_ERROR");
  }

  // パストラバーサル攻撃対策: name に '..' が含まれていないかチェック
  if (name.includes("..")) {
    return createErrorResponse(
      "ノートブック名に '..' を含めることはできません",
      "VALIDATION_ERROR"
    );
  }

  // NULL バイト攻撃対策
  if (name.includes("\0")) {
    return createErrorResponse(
      "ノートブック名に不正な文字が含まれています",
      "VALIDATION_ERROR"
    );
  }

  // 名前の長さチェック（DoS対策）
  if (name.length > 200) {
    return createErrorResponse(
      "ノートブック名が長すぎます（最大200文字）",
      "VALIDATION_ERROR"
    );
  }

  try {
    // ノートブック名の処理（.ipynb 拡張子を追加）
    const notebookName = name.endsWith(".ipynb") ? name : `${name}.ipynb`;

    // 完全なパスを構築
    const normalizedPath = path.endsWith("/") ? path : `${path}/`;
    const fullPath =
      normalizedPath === "/" ? notebookName : `${normalizedPath}${notebookName}`;

    // ノートブックを作成
    const result = await jupyterClient.createNotebook(fullPath);

    return createSuccessResponse({
      path: result.path,
      created_at: result.created_at,
      message: `ノートブック "${notebookName}" を作成しました`,
    });
  } catch (error) {
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
