/**
 * 画像リソースハンドラ
 *
 * MCP リソースプロトコルの実装：
 * - resources/list: 画像一覧を返す
 * - resources/read: 画像データを返す
 */

import { imageStore } from "../image-store/index.js";

/**
 * リソースURIのスキーム
 */
const RESOURCE_URI_SCHEME = 'jupyter://sessions';

/**
 * MIMEタイプからファイル拡張子を取得
 *
 * @param mimeType MIMEタイプ
 * @returns ファイル拡張子
 */
function getExtensionFromMimeType(mimeType: string): string {
  const mapping: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/gif": "gif",
  };

  return mapping[mimeType] || "png";
}

/**
 * 画像リソース一覧を取得
 *
 * @param uriPrefix オプショナルなURIプレフィックスでフィルタ（例: "jupyter://sessions/abc123/"）
 * @returns MCPリソース一覧
 */
export function listResources(uriPrefix?: string): { resources: Array<{ uri: string; name: string; mimeType: string; description: string }> } {
  // 全画像を取得
  const allImages = imageStore.listAll();

  // URIプレフィックスでフィルタ（指定されている場合）
  const images = uriPrefix
    ? allImages.filter((img) => {
        const uri = `${RESOURCE_URI_SCHEME}/${img.sessionId}/images/${img.id}.${getExtensionFromMimeType(img.mimeType)}`;
        return uri.startsWith(uriPrefix);
      })
    : allImages;

  // MCPリソース形式に変換
  const resources = images.map((img) => {
    const extension = getExtensionFromMimeType(img.mimeType);
    const uri = `${RESOURCE_URI_SCHEME}/${img.sessionId}/images/${img.id}.${extension}`;

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
