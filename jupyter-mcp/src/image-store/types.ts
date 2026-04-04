/**
 * 画像関連の型定義
 */

/**
 * MCPツールのレスポンスに含まれる画像参照
 *
 * 画像ファイルは jupyter-server 側でワークスペースの output/ に保存済み。
 * MCP レスポンスではファイルパスのみを返し、base64 データは含めない。
 */
export interface ImageReference {
  /** 画像ファイルパス（例: workspaces/{workspace_id}/output/exec-1-img-001.png） */
  file_path: string;
  /** MIMEタイプ */
  mime_type: string;
  /** 画像の説明 */
  description: string;
}
