/**
 * get_image_resource ツール実装
 *
 * execute_code で生成された画像を取得する。
 * AI クライアントが MCP リソース API を直接呼べない場合に使用する。
 */

import { imageStore } from "../image-store/index.js";
import {
  createSuccessResponse,
  createErrorResponse,
  type McpResponse,
} from "../utils/response-formatter.js";
import { validateStringParameter } from "../utils/validation.js";

interface GetImageResourceArgs {
  resource_uri: string;
}

/**
 * 画像リソースを取得する
 *
 * @param args ツール引数
 * @returns 画像データ（base64）
 */
export async function executeGetImageResource(
  args: Record<string, unknown>
): Promise<McpResponse> {
  const { resource_uri } = args as Partial<GetImageResourceArgs>;

  // 入力検証: resource_uri
  const uriValidation = validateStringParameter(resource_uri, "resource_uri", {
    required: true,
    maxLength: 500,
    allowEmpty: false,
  });

  if (!uriValidation.isValid) {
    return createErrorResponse(
      uriValidation.errorMessage!,
      "VALIDATION_ERROR"
    );
  }

  // 検証後、resource_uri は必ず string
  const validatedResourceUri = resource_uri as string;

  try {
    // 画像データを取得
    const image = imageStore.get(validatedResourceUri);

    if (!image) {
      return createErrorResponse(
        `指定されたリソースURIの画像が見つかりません: ${validatedResourceUri}`,
        "NOT_FOUND"
      );
    }

    // レスポンスを生成
    return createSuccessResponse({
      mime_type: image.mimeType,
      data: image.data,
      width: image.width,
      height: image.height,
    });
  } catch (error) {
    // imageStore.get() の内部エラー（不正なURI形式等）
    if (error instanceof Error) {
      return createErrorResponse(
        `画像の取得に失敗しました: ${error.message}`,
        "INVALID_URI"
      );
    }

    return createErrorResponse(
      "画像の取得中に予期しないエラーが発生しました",
      "INTERNAL_ERROR"
    );
  }
}
