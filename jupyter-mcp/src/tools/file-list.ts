/**
 * file_list ツール実装
 */

import { jupyterClient } from "../jupyter-client/client.js";
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from "../utils/response-formatter.js";
import { validateStringParameter } from "../utils/validation.js";

/**
 * file_list の引数型
 */
interface FileListArgs {
  session_id: string;
  path?: string;
}

/**
 * パスを正規化する（file_list専用）
 * - ルートディレクトリは "" または "/" で指定可能
 * - 先頭の "/" を除去して正規化
 * - 空文字列の場合はルートディレクトリとして "/" を返す
 *
 * @param path - ユーザー入力のパス
 * @returns 正規化されたパス
 * @throws Error - パスが不正な場合
 */
function normalizeFilePath(path: string): string {
  // パストラバーサル攻撃の検出
  if (path.includes("..")) {
    throw new Error("パスに '..' を含めることはできません");
  }

  // NULL バイト攻撃の検出
  if (path.includes("\0")) {
    throw new Error("パスに不正な文字が含まれています");
  }

  // パスの長さチェック（DoS対策）
  if (path.length > 500) {
    throw new Error("パスが長すぎます（最大500文字）");
  }

  // 先頭の '/' を除去（正規化）
  const normalized = path.replace(/^\/+/, '');

  // 正規化後が空文字の場合は "/" を返す（ルートディレクトリ）
  if (normalized === "") {
    return "/";
  }

  return normalized;
}

/**
 * ワークスペース内のファイル一覧を取得する
 */
export async function executeFileList(
  args: Record<string, unknown>
): Promise<McpResponse> {
  // session_id の検証
  const sessionIdValidation = validateStringParameter(args.session_id, "session_id", {
    required: true,
    maxLength: 100,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(
      sessionIdValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 型キャスト（検証済み）
  const session_id = args.session_id as string;
  const path = (args.path as string | undefined) ?? "/";

  // path の検証
  if (path !== undefined && path !== null) {
    const pathValidation = validateStringParameter(path, "path", {
      required: false,
      allowEmpty: true, // "/" のみの場合も許可
    });

    if (!pathValidation.isValid) {
      return createErrorResponse(
        pathValidation.errorMessage!,
        "VALIDATION_ERROR"
      );
    }
  }

  try {
    // パスを正規化
    const normalizedPath = normalizeFilePath(path);

    // ファイル一覧を取得
    const contents = await jupyterClient.listContents(normalizedPath);

    return createSuccessResponse({
      path: normalizedPath,
      contents: contents.contents,
    });
  } catch (error) {
    // パス検証エラーの場合
    if (error instanceof Error && error.message.includes("'..'")) {
      return createErrorResponse(error.message, "VALIDATION_ERROR");
    }

    // その他のエラー
    return createErrorResponse(
      extractErrorMessage(error),
      extractErrorCode(error)
    );
  }
}
