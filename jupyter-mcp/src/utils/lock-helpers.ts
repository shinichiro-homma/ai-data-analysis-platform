/**
 * ノートブックロックのミドルウェアヘルパー（タスク 21.2）
 *
 * ノートブック編集系ツールの実行を jupyter-server 側のロックで保護する。
 * - notebook_path を解決し acquireLock を呼ぶ
 * - acquire が 423（NotebookLockedError）なら execute せず NOTEBOOK_LOCKED を返す
 * - 取得成功時は 20 秒間隔の renew タイマーを張り、finally で release + タイマー解除
 * - release 失敗は warn ログのみ（TTL 失効に委ねる）= 固着バグの根絶
 * - notebook_path を解決できない場合はロックせず execute する
 */

import { jupyterClient } from '../jupyter-client/client.js';
import { NotebookLockedError } from '../jupyter-client/errors.js';
import { resolveNotebookPath } from './session-resolver.js';
import { createErrorResponse, type McpToolResult } from './response-formatter.js';
import { lockTokenStorage } from './lock-context.js';
import { normalizeNotebookPath } from './path-validator.js';
import { logger } from './logger.js';

/** ロック TTL 延長（renew）の間隔（ミリ秒）。サーバー TTL 60 秒に対し 20 秒間隔で更新する。 */
const RENEW_INTERVAL_MS = 20000;

/**
 * args から notebook_path を解決する（notebook_path 直接指定 → session_id 経由）。
 *
 * 解決したパスは各ツールの書き込み・サーバー側ロックキーと一致させるため
 * normalizeNotebookPath で正規化する（先頭スラッシュ除去等）。正規化に失敗する
 * パス（.ipynb 以外・不正パス等）は null を返し、ロックせずツール側バリデーションに委ねる。
 */
async function resolveNotebookPathFromArgs(args: Record<string, unknown>): Promise<string | null> {
  let rawPath: string | null = null;

  const notebookPath = args.notebook_path;
  if (typeof notebookPath === 'string' && notebookPath.length > 0) {
    rawPath = notebookPath;
  } else {
    const sessionId = args.session_id;
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      rawPath = await resolveNotebookPath(sessionId);
    }
  }

  if (!rawPath) {
    return null;
  }

  try {
    return normalizeNotebookPath(rawPath);
  } catch {
    // 正規化に失敗するパスはロックせず execute に委ねる（ツール側バリデーションで拒否される）
    return null;
  }
}

/**
 * ツール実行をノートブックロックで保護するミドルウェアヘルパー。
 *
 * ロック競合時は NOTEBOOK_LOCKED エラーレスポンスを返す。
 */
export async function withNotebookLock(
  args: Record<string, unknown>,
  execute: () => Promise<McpToolResult>,
): Promise<McpToolResult> {
  const notebookPath = await resolveNotebookPathFromArgs(args);

  // notebook_path を解決できない場合はロックせずに実行する
  if (!notebookPath) {
    return execute();
  }

  // ロック取得。競合（423）ならツールを実行せず NOTEBOOK_LOCKED を返す。
  let lockToken: string;
  try {
    const lock = await jupyterClient.acquireLock(notebookPath);
    lockToken = lock.lockToken;
  } catch (error) {
    if (error instanceof NotebookLockedError) {
      return createErrorResponse(
        `ノートブックが他の操作でロックされています: ${notebookPath}。完了を待って再試行してください。`,
        'NOTEBOOK_LOCKED',
      );
    }
    throw error;
  }

  // 実行中は定期的に renew してサーバー TTL の失効を防ぐ
  const renewTimer = setInterval(() => {
    // 意図的にベストエフォート: renew 失敗時も execute を中断しない。
    // 書き込みの強制はサーバー側（contents_manager.save の 423）が担保するため、
    // ここで renew が失敗しても最悪 TTL 失効で自然にロックが解放されるだけであり、
    // execute 側のフローを止める必要はない。
    void jupyterClient.renewLock(notebookPath, lockToken).catch((error) => {
      logger.warn(`[withNotebookLock] renew failed for ${notebookPath}:`, error);
    });
  }, RENEW_INTERVAL_MS);

  try {
    // ロックトークンを AsyncLocalStorage に載せて execute する。
    // 配下の jupyter-client リクエストは自動的に X-Lock-Token を付与し、
    // サーバー側ロック検査で自己ロックアウトしない。
    return await lockTokenStorage.run({ lockToken }, execute);
  } finally {
    clearInterval(renewTimer);
    try {
      await jupyterClient.releaseLock(notebookPath, lockToken);
    } catch (error) {
      // release 失敗は握りつぶさずに warn ログのみ。TTL 失効に委ねる（固着バグの根絶）。
      logger.warn(`[withNotebookLock] release failed for ${notebookPath}:`, error);
    }
  }
}
