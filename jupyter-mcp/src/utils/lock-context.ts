/**
 * ロックトークンの実行コンテキスト伝播（タスク 21.2）
 *
 * withNotebookLock がロックを取得している間、そのトークンを Node の
 * AsyncLocalStorage に保持する。jupyter-client の request() がこのストアを読んで
 * すべての書き込みリクエストに X-Lock-Token ヘッダーを自動付与する。
 *
 * この仕組みにより「書き込みメソッドが増えてもトークン付与が漏れない」ことを構造で保証する
 * （各メソッドへの引数貫通は不要）。client.ts と lock-helpers.ts の双方から参照するため、
 * 循環インポートを避ける目的で独立モジュールに切り出す。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** 現在の実行フローに紐づくロックトークンを保持するストア。 */
export const lockTokenStorage = new AsyncLocalStorage<{ lockToken: string }>();

/** 現在の実行コンテキストのロックトークンを返す（未設定時は undefined）。 */
export function getCurrentLockToken(): string | undefined {
  return lockTokenStorage.getStore()?.lockToken;
}
