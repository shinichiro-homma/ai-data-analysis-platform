/**
 * 画像ストア実装
 *
 * インメモリで画像データを保存し、MCPリソースURIを生成する。
 */

import { randomUUID } from "crypto";
import type { StoredImage, ImageReference, ImageOutput } from "./types.js";
import { buildResourceUri, extractImageIdFromUri } from "./uri-utils.js";

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
   * @throws Error sessionId または imageData が無効な場合
   */
  store(sessionId: string, imageData: ImageOutput): ImageReference {
    // 入力検証
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid sessionId');
    }
    if (!imageData || !imageData.mime_type || !imageData.data) {
      throw new Error('Invalid imageData');
    }

    // 画像IDを生成
    const imageId = randomUUID();

    // セッションごとのカウンターを取得・更新
    const currentCount = this.sessionCounters.get(sessionId) || 0;
    const newCount = currentCount + 1;
    this.sessionCounters.set(sessionId, newCount);

    // リソースURIを生成
    const resourceUri = buildResourceUri(sessionId, imageId, imageData.mime_type);

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
   * @throws Error resourceUri が無効な形式の場合
   */
  get(resourceUri: string): StoredImage | undefined {
    // 入力検証
    if (!resourceUri || typeof resourceUri !== 'string') {
      throw new Error('Invalid resourceUri');
    }

    // URIからimageIdを抽出
    const imageId = extractImageIdFromUri(resourceUri);
    if (!imageId) {
      return undefined;
    }

    return this.images.get(imageId);
  }

  /**
   * 全セッションの全画像を取得
   *
   * @returns StoredImageの配列
   */
  listAll(): StoredImage[] {
    return Array.from(this.images.values());
  }

  /**
   * セッションに紐づく画像一覧を取得
   *
   * @param sessionId セッションID
   * @returns StoredImageの配列
   */
  listBySession(sessionId: string): StoredImage[] {
    return Array.from(this.images.values()).filter(
      (image) => image.sessionId === sessionId
    );
  }

  /**
   * セッションに紐づく画像をすべて削除
   *
   * @param sessionId セッションID
   */
  deleteBySession(sessionId: string): void {
    // セッションに紐づく画像を抽出して削除
    const imageIdsToDelete = Array.from(this.images.entries())
      .filter(([, image]) => image.sessionId === sessionId)
      .map(([imageId]) => imageId);

    // 削除実行
    for (const imageId of imageIdsToDelete) {
      this.images.delete(imageId);
    }

    // カウンターもクリア
    this.sessionCounters.delete(sessionId);
  }

}

/**
 * シングルトンインスタンス
 */
export const imageStore = new ImageStore();
