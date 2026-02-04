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

/**
 * Jupyter APIから返される画像出力
 *
 * Note: この型は jupyter-client/types.ts の ImageOutput と同じ構造を持つ
 */
export interface ImageOutput {
  /** 画像ID（jupyter-server が生成） */
  id: string;
  /** MIMEタイプ */
  mime_type: string;
  /** base64エンコードされた画像データ */
  data: string;
  /** 幅（オプション） */
  width?: number;
  /** 高さ（オプション） */
  height?: number;
}
