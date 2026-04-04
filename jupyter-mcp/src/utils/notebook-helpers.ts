/**
 * ノートブック操作の共通ヘルパー関数
 */

import { jupyterClient } from '../jupyter-client/client.js';

const DEFAULT_TIMEOUT_MS = 3000;

/**
 * タイムアウト付きでノートブックの内容を取得する
 *
 * @param notebookPath - ノートブックのパス
 * @param timeoutMs - タイムアウト（ミリ秒、デフォルト: 3000）
 * @returns ノートブックの内容
 * @throws タイムアウトまたは読み取りエラー
 */
export async function getContentsWithTimeout(
  notebookPath: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): ReturnType<typeof jupyterClient.getContents> {
  return Promise.race([
    jupyterClient.getContents(notebookPath),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getContents timeout')), timeoutMs)),
  ]);
}
