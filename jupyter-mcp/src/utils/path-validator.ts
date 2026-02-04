/**
 * パス検証ユーティリティ
 */

import { ValidationError } from './errors.js';

/**
 * パスを正規化する（汎用版）
 * セキュリティチェックを実施し、安全なパスに変換する
 *
 * @param path - ユーザー入力のパス
 * @param options - 正規化オプション
 * @param options.allowEmpty - 空パスを許可するか（デフォルト: false）
 * @param options.allowRoot - ルートディレクトリ（"/"）を許可するか（デフォルト: false）
 * @param options.maxLength - パスの最大長（デフォルト: 500）
 * @returns 正規化されたパス（先頭の '/' を除去、空パスの場合は "/" または例外）
 * @throws ValidationError - パスが不正な場合
 */
export function normalizePath(
  path: string,
  options: {
    allowEmpty?: boolean;
    allowRoot?: boolean;
    maxLength?: number;
  } = {}
): string {
  const { allowEmpty = false, allowRoot = false, maxLength = 500 } = options;

  // 空文字チェック
  if (!path || path.trim() === "") {
    if (allowEmpty || allowRoot) {
      return "/"; // ルートディレクトリとして扱う
    }
    throw new ValidationError("パスが空です");
  }

  // パストラバーサル攻撃の検出
  if (path.includes("..")) {
    throw new ValidationError("パスに '..' を含めることはできません");
  }

  // NULL バイト攻撃の検出
  if (path.includes("\0")) {
    throw new ValidationError("パスに不正な文字が含まれています");
  }

  // パスの長さチェック（DoS対策）
  if (path.length > maxLength) {
    throw new ValidationError(`パスが長すぎます（最大${maxLength}文字）`);
  }

  // 先頭の '/' を除去（正規化）
  const normalized = path.replace(/^\/+/, '');

  // 正規化後が空文字の場合
  if (normalized === "") {
    if (allowRoot) {
      return "/"; // ルートディレクトリとして扱う
    }
    throw new ValidationError("パスが空です");
  }

  return normalized;
}

/**
 * ノートブックパスを正規化する
 * セキュリティチェックを実施し、安全な相対パスに変換する
 *
 * @param path - ユーザー入力のパス
 * @returns 正規化されたパス（先頭の '/' を除去）
 * @throws ValidationError - パスが不正な場合
 */
export function normalizeNotebookPath(path: string): string {
  return normalizePath(path, { allowEmpty: false, allowRoot: false });
}

/**
 * ノートブックパスを検証する（後方互換性のため残す）
 * パストラバーサル攻撃を防ぐため、以下をチェック:
 * - パスが '..' を含まないこと
 * - パスが '/' で始まらないこと（相対パスのみ許可）
 * - パスが '.ipynb' で終わること
 *
 * @param path - 検証するパス
 * @throws Error - パスが不正な場合
 * @deprecated normalizeNotebookPath を使用してください
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
