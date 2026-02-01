/**
 * パス検証ユーティリティ
 */

/**
 * ノートブックパスを検証する
 * パストラバーサル攻撃を防ぐため、以下をチェック:
 * - パスが '..' を含まないこと
 * - パスが '/' で始まらないこと（相対パスのみ許可）
 * - パスが '.ipynb' で終わること
 *
 * @param path - 検証するパス
 * @throws Error - パスが不正な場合
 */
export function validateNotebookPath(path: string): void {
  // 空文字チェック
  if (!path || path.trim() === "") {
    throw new Error("パスが空です");
  }

  // パストラバーサル攻撃の検出
  if (path.includes("..")) {
    throw new Error("パスに '..' を含めることはできません");
  }

  // 絶対パスの検出（セキュリティ上、相対パスのみ許可）
  if (path.startsWith("/")) {
    throw new Error("絶対パスは使用できません");
  }

  // NULL バイト攻撃の検出
  if (path.includes("\0")) {
    throw new Error("パスに不正な文字が含まれています");
  }

  // .ipynb 拡張子のチェック
  if (!path.endsWith(".ipynb")) {
    throw new Error("ノートブックパスは '.ipynb' で終わる必要があります");
  }

  // パスの長さチェック（DoS対策）
  if (path.length > 255) {
    throw new Error("パスが長すぎます（最大255文字）");
  }
}
