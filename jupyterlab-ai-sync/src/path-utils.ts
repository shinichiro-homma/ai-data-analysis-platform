/**
 * パス操作のユーティリティ関数
 */

/**
 * ノートブックパスを正規化する（先頭のスラッシュを削除）
 */
export function normalizeNotebookPath(path: string): string {
  return path.startsWith('/') ? path.substring(1) : path;
}
