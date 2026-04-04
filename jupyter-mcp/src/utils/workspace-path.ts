/**
 * ワークスペースパス変換のユーティリティ
 */

/**
 * ワークスペース内の絶対パスをカーネル cwd 相対パスに変換する。
 *
 * REST API は content root 相対（例: "workspaces/ws-xxx/data"）だが、
 * カーネルの cwd はワークスペースディレクトリなので、プレフィックスを除去する。
 *
 * @param fullPath - 変換対象のパス（例: "workspaces/ws-xxx/data"）
 * @param workspacePath - ワークスペースのパス（例: "workspaces/ws-xxx"）
 * @returns カーネル相対パス（例: "data"）、fullPath が undefined の場合は undefined
 */
export function toKernelRelativePath(fullPath: string | undefined, workspacePath: string): string | undefined {
  if (!fullPath) return undefined;

  const prefix = workspacePath + '/';
  if (fullPath.startsWith(prefix)) {
    return fullPath.substring(prefix.length);
  }
  // プレフィックスが一致しない場合は元のパスを返す
  return fullPath;
}

/**
 * セッションのノートブックパスからワークスペースIDを抽出する。
 *
 * セッション作成時のパスは "workspaces/{workspace_id}/{notebook}" の形式。
 * この形式に一致しない場合は null を返す。
 *
 * @param notebookPath - セッションのノートブックパス（例: "workspaces/ws-xxx/analysis.ipynb"）
 * @returns ワークスペースID（例: "ws-xxx"）、抽出できない場合は null
 */
export function extractWorkspaceId(notebookPath: string | null): string | null {
  if (!notebookPath) return null;

  const match = notebookPath.match(/^workspaces\/([^/]+)\//);
  if (!match) return null;

  const workspaceId = match[1];
  // パストラバーサル防止
  if (workspaceId.includes('..')) return null;

  return workspaceId;
}
