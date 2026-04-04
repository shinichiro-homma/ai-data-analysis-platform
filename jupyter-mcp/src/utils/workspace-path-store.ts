/**
 * ワークスペースID → Contents APIパスのキャッシュ
 *
 * サーバーAPIが返す path（例: "workspaces/sample/ws-XXX"）を保持し、
 * 各ツールがContents APIパスを構築する際に使用する。
 */

import { jupyterClient } from '../jupyter-client/client.js';

/** workspace_id → Contents API パス */
const pathMap = new Map<string, string>();

/**
 * ワークスペースパスを登録する
 */
export function registerWorkspacePath(workspaceId: string, path: string): void {
  pathMap.set(workspaceId, path);
}

/**
 * キャッシュからワークスペースパスを取得する（キャッシュミス時は undefined）
 */
export function getCachedWorkspacePath(workspaceId: string): string | undefined {
  return pathMap.get(workspaceId);
}

/**
 * ワークスペースIDからContents APIパスを解決する。
 *
 * 1. キャッシュから検索
 * 2. キャッシュミス時はワークスペース一覧APIを呼び出してキャッシュを更新
 *
 * @throws Error ワークスペースが見つからない場合
 */
export async function resolveWorkspacePath(workspaceId: string): Promise<string> {
  const cached = pathMap.get(workspaceId);
  if (cached) return cached;

  // フォールバック: APIから一覧取得してキャッシュ更新
  const workspaces = await jupyterClient.listWorkspaces();
  for (const ws of workspaces) {
    pathMap.set(ws.workspace_id, ws.path);
  }

  const resolved = pathMap.get(workspaceId);
  if (!resolved) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  return resolved;
}

/**
 * ノートブックパスからワークスペースIDを逆引きする。
 *
 * キャッシュに登録されたパスプレフィックスと照合して特定する。
 * キャッシュが空の場合はAPIから一覧を取得する。
 *
 * @returns ワークスペースID、特定できない場合は null
 */
export async function extractWorkspaceIdFromPath(notebookPath: string): Promise<string | null> {
  // キャッシュが空ならAPIから取得
  if (pathMap.size === 0) {
    try {
      const workspaces = await jupyterClient.listWorkspaces();
      for (const ws of workspaces) {
        pathMap.set(ws.workspace_id, ws.path);
      }
    } catch {
      // API失敗時はnullを返す
    }
  }

  for (const [wsId, wsPath] of pathMap) {
    if (notebookPath === wsPath || notebookPath.startsWith(wsPath + '/')) {
      return wsId;
    }
  }
  return null;
}
