/**
 * URI関連のユーティリティ関数
 *
 * 画像リソースURIの生成・パース処理を提供する。
 */

import type { StoredImage } from "./types.js";

/**
 * リソースURIのスキーム
 */
export const RESOURCE_URI_SCHEME = 'jupyter://sessions';

/**
 * リソースURIのパターン（imageIdを抽出するための正規表現）
 */
const RESOURCE_URI_PATTERN = /^jupyter:\/\/sessions\/[^/]+\/images\/([^.]+)\.[^.]+$/;

/**
 * MIMEタイプからファイル拡張子を取得
 *
 * @param mimeType MIMEタイプ
 * @returns ファイル拡張子
 */
export function getExtensionFromMimeType(mimeType: string): string {
  const mapping: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/gif": "gif",
  };

  return mapping[mimeType] || "png";
}

/**
 * 画像リソースURIを生成
 *
 * @param sessionId セッションID
 * @param imageId 画像ID
 * @param mimeType MIMEタイプ
 * @returns リソースURI
 */
export function buildResourceUri(sessionId: string, imageId: string, mimeType: string): string {
  const extension = getExtensionFromMimeType(mimeType);
  return `${RESOURCE_URI_SCHEME}/${sessionId}/images/${imageId}.${extension}`;
}

/**
 * 画像からリソースURIを生成
 *
 * @param image StoredImage
 * @returns リソースURI
 */
export function buildResourceUriFromImage(image: StoredImage): string {
  return buildResourceUri(image.sessionId, image.id, image.mimeType);
}

/**
 * リソースURIから画像IDを抽出
 *
 * @param resourceUri MCPリソースURI
 * @returns 画像ID または null
 */
export function extractImageIdFromUri(resourceUri: string): string | null {
  const match = resourceUri.match(RESOURCE_URI_PATTERN);
  return match ? match[1] : null;
}
