/**
 * 画像リソースハンドラ
 *
 * MCP リソースプロトコルの実装：
 * - resources/list: 画像一覧を返す
 * - resources/read: 画像データを返す
 */

import { imageStore } from "../image-store/index.js";
import { buildResourceUriFromImage } from "../image-store/uri-utils.js";
import type { Resource } from "@modelcontextprotocol/sdk/types.js";

/**
 * 画像リソース一覧を取得
 *
 * @param uriPrefix オプショナルなURIプレフィックスでフィルタ（例: "jupyter://sessions/abc123/"）
 * @returns MCPリソース一覧
 */
export function listResources(uriPrefix?: string): { resources: Resource[] } {
  // 全画像を取得
  const allImages = imageStore.listAll();

  // URIプレフィックスでフィルタ（指定されている場合）
  const images = uriPrefix
    ? allImages.filter((img) => {
        const uri = buildResourceUriFromImage(img);
        return uri.startsWith(uriPrefix);
      })
    : allImages;

  // MCPリソース形式に変換
  const resources: Resource[] = images.map((img) => {
    const uri = buildResourceUriFromImage(img);

    return {
      uri,
      name: img.description,
      mimeType: img.mimeType,
      description: img.description,
    };
  });

  return { resources };
}

/**
 * 指定URIの画像データを取得
 *
 * @param uri リソースURI
 * @returns MCP BlobResourceContents
 * @throws Error 画像が見つからない場合
 */
export function readResource(uri: string): { contents: Array<{ uri: string; mimeType: string; blob: string }> } {
  // 画像データを取得
  const image = imageStore.get(uri);

  if (!image) {
    throw new Error(`Image not found: ${uri}`);
  }

  // MCP BlobResourceContents形式で返却
  return {
    contents: [
      {
        uri,
        mimeType: image.mimeType,
        blob: image.data, // 既にbase64形式
      },
    ],
  };
}
