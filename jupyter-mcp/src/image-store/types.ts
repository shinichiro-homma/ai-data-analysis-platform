/**
 * 画像ストア用の型定義
 */

/**
 * ストレージに保存される画像データ
 */
export interface StoredImage {
  /** 画像ID（ユニーク） */
  id: string;
  /** セッションID */
  sessionId: string;
  /** MIMEタイプ（例: image/png） */
  mimeType: string;
  /** base64エンコードされた画像データ */
  data: string;
  /** 画像の幅（ピクセル、オプション） */
  width?: number;
  /** 画像の高さ（ピクセル、オプション） */
  height?: number;
  /** 作成日時 */
  createdAt: Date;
  /** 画像の説明（例: "matplotlib output [1]"） */
  description: string;
}

/**
 * MCPツールのレスポンスに含まれる画像参照
 */
export interface ImageReference {
  /** MCPリソースURI（例: jupyter://sessions/abc123/images/output-001.png） */
  resource_uri: string;
  /** MIMEタイプ */
  mime_type: string;
  /** 画像の説明 */
  description: string;
}

// ImageOutput は jupyter-client/types.ts から import して使用する
export type { ImageOutput } from '../jupyter-client/types.js';
