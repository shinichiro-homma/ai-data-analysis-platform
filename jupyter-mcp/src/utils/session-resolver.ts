/**
 * セッション関連のユーティリティ関数
 */

import { jupyterClient } from "../jupyter-client/client.js";

/**
 * session_id を kernel_id に解決する
 *
 * session_id として渡される値は2つのパターンがある:
 * 1. notebook_path 付きで作成された場合: session.id（session.kernel.id を取得する必要がある）
 * 2. notebook_path なしで作成された場合: kernel.id そのもの
 *
 * @param sessionId - session_id パラメータ
 * @returns kernel_id
 */
export async function resolveKernelId(sessionId: string): Promise<string> {
  try {
    // まず、session として検索
    const sessions = await jupyterClient.listSessions();
    const session = sessions.find(s => s.id === sessionId);

    if (session) {
      // session として見つかった場合: session.kernel.id を使用
      return session.kernel.id;
    }

    // session として見つからない場合: session_id をそのまま kernel_id として使用
    // （notebook_path なしで作成された場合、kernel.id が返されている）
    return sessionId;
  } catch (error) {
    // listSessions が失敗した場合も、session_id をそのまま返す
    // （後続の API 呼び出しでエラーになる）
    return sessionId;
  }
}
