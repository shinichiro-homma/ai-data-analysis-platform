/**
 * 画像ストア実装
 *
 * インメモリで画像データを保存し、MCPリソースURIを生成する。
 */

import { randomUUID } from "crypto";
import type { StoredImage, ImageReference, ImageOutput } from "./types.js";

/**
 * 画像ストアクラス
 *
 * セッション内で生成された画像をメモリ上に保存し、
 * リソースURIベースでアクセス可能にする。
 */
class ImageStore {
  /** 画像データのストレージ（key: imageId, value: StoredImage） */
  private images: Map<string, StoredImage> = new Map();

  /** セッションごとの画像カウンター（description生成用） */
  private sessionCounters: Map<string, number> = new Map();

  /**
   * 画像を保存し、ImageReferenceを返す
   *
   * @param sessionId セッションID
   * @param imageData Jupyter APIから返された画像データ
   * @returns ImageReference（resource_uri を含む）
   */
  store(sessionId: string, imageData: ImageOutput): ImageReference {
    // 画像IDを生成
    const imageId = randomUUID();

    // セッションごとのカウンターを取得・更新
    const currentCount = this.sessionCounters.get(sessionId) || 0;
    const newCount = currentCount + 1;
    this.sessionCounters.set(sessionId, newCount);

    // ファイル拡張子を決定
    const extension = this.getExtensionFromMimeType(imageData.mime_type);

    // リソースURIを生成
    const resourceUri = `jupyter://sessions/${sessionId}/images/${imageId}.${extension}`;

    // 説明を生成
    const description = `matplotlib output [${newCount}]`;

    // ストレージに保存
    const storedImage: StoredImage = {
      id: imageId,
      sessionId,
      mimeType: imageData.mime_type,
      data: imageData.data,
      width: imageData.width,
      height: imageData.height,
      createdAt: new Date(),
      description,
    };

    this.images.set(imageId, storedImage);

    // ImageReferenceを返す
    return {
      resource_uri: resourceUri,
      mime_type: imageData.mime_type,
      description,
    };
  }

  /**
   * リソースURIから画像データを取得
   *
   * @param resourceUri MCPリソースURI
   * @returns StoredImage または undefined
   */
  get(resourceUri: string): StoredImage | undefined {
    // URIからimageIdを抽出
    const imageId = this.extractImageIdFromUri(resourceUri);
    if (!imageId) {
      return undefined;
    }

    return this.images.get(imageId);
  }

  /**
   * セッションに紐づく画像一覧を取得
   *
   * @param sessionId セッションID
   * @returns StoredImageの配列
   */
  listBySession(sessionId: string): StoredImage[] {
    const result: StoredImage[] = [];

    for (const image of this.images.values()) {
      if (image.sessionId === sessionId) {
        result.push(image);
      }
    }

    return result;
  }

  /**
   * セッションに紐づく画像をすべて削除
   *
   * @param sessionId セッションID
   */
  deleteBySession(sessionId: string): void {
    // 削除対象のimageIdを収集
    const imageIdsToDelete: string[] = [];

    for (const [imageId, image] of this.images.entries()) {
      if (image.sessionId === sessionId) {
        imageIdsToDelete.push(imageId);
      }
    }

    // 削除実行
    for (const imageId of imageIdsToDelete) {
      this.images.delete(imageId);
    }

    // カウンターもクリア
    this.sessionCounters.delete(sessionId);
  }

  /**
   * MIMEタイプからファイル拡張子を取得
   *
   * @param mimeType MIMEタイプ
   * @returns ファイル拡張子
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const mapping: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/svg+xml": "svg",
      "image/gif": "gif",
    };

    return mapping[mimeType] || "png";
  }

  /**
   * リソースURIから画像IDを抽出
   *
   * @param resourceUri MCPリソースURI
   * @returns 画像ID または null
   */
  private extractImageIdFromUri(resourceUri: string): string | null {
    // 形式: jupyter://sessions/{session_id}/images/{image_id}.{ext}
    const match = resourceUri.match(/^jupyter:\/\/sessions\/[^/]+\/images\/([^.]+)\.[^.]+$/);

    if (!match) {
      return null;
    }

    return match[1]; // imageId
  }
}

/**
 * シングルトンインスタンス
 */
export const imageStore = new ImageStore();
