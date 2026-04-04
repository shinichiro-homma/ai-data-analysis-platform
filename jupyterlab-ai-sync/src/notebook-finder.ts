/**
 * ノートブック検索ユーティリティ
 */
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { normalizeNotebookPath } from './path-utils';

/**
 * パスでノートブックを探す
 *
 * @param notebookTracker - JupyterLab のノートブックトラッカー
 * @param path - ノートブックパス
 * @returns 見つかった NotebookPanel、または null
 */
export function findNotebookByPath(notebookTracker: INotebookTracker, path: string): NotebookPanel | null {
  const normalizedPath = normalizeNotebookPath(path);

  // 完全一致: まず現在のウィジェットをチェック
  const current = notebookTracker.currentWidget;
  if (current && current.context.path === normalizedPath) {
    return current;
  }

  // 完全一致: find() メソッドを使用してノートブックを探す
  const widget = notebookTracker.find((w) => w.context.path === normalizedPath);
  if (widget) {
    return widget;
  }

  // サフィックスマッチ: ワークスペース相対パス（例: "sync-test.ipynb"）が
  // フルパス（例: "workspaces/ws-xxx/sync-test.ipynb"）の末尾と一致する場合
  const suffix = '/' + normalizedPath;
  if (current && current.context.path.endsWith(suffix)) {
    return current;
  }

  const suffixWidget = notebookTracker.find((w) => w.context.path.endsWith(suffix));
  return suffixWidget || null;
}
