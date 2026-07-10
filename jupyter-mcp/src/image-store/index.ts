/**
 * 画像参照のマッピング
 *
 * jupyter-server が返す ImageOutput を MCP レスポンス用の ImageReference に変換する。
 * 画像ファイル自体は jupyter-server 側でワークスペースの output/ に保存済み。
 */

import type { ImageReference } from './types.js';
import type { ImageOutput } from '../jupyter-client/types.js';

/**
 * jupyter-server が返す ImageOutput を MCP レスポンス用の ImageReference に変換する。
 */
export function toImageReference(image: ImageOutput & { file_path: string }): ImageReference {
  return {
    file_path: image.file_path,
    mime_type: image.mime_type,
    description: image.description,
  };
}
