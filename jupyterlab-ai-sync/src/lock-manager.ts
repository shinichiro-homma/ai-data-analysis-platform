/**
 * ノートブックロック管理
 */
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { LockIndicator } from './ui/lock-indicator';
import { normalizeNotebookPath } from './path-utils';
import { findNotebookByPath } from './notebook-finder';

/**
 * ロック中にブロックするコマンド ID セット。
 * カーネル中断（notebook:interrupt-kernel / kernelmenu:interrupt）は F3.3 の要件により含めない。
 */
const BLOCKED_COMMAND_IDS = new Set<string>([
  // セル実行
  'notebook:run-cell',
  'notebook:run-cell-and-select-next',
  'notebook:run-cell-and-insert-below',
  'notebook:run-in-console',
  'notebook:run-all-cells',
  'notebook:run-all-above',
  'notebook:run-all-below',
  'notebook:restart-run-all',
  'notebook:restart-and-run-to-selected',
  // セル追加
  'notebook:insert-cell-above',
  'notebook:insert-cell-below',
  // セル削除
  'notebook:delete-cell',
  // セル切り取り/貼付
  'notebook:cut-cell',
  'notebook:paste-cell-above',
  'notebook:paste-cell-below',
  'notebook:paste-and-replace',
  // セル並び替え
  'notebook:move-cell-up',
  'notebook:move-cell-down',
  // セル分割/結合
  'notebook:split-cell-at-cursor',
  'notebook:merge-cells',
  'notebook:merge-cell-above',
  'notebook:merge-cell-below',
  // セル種別変更
  'notebook:change-cell-to-code',
  'notebook:change-cell-to-markdown',
  'notebook:change-cell-to-raw',
]);

interface LockState {
  indicator: LockIndicator;
  keydownHandler: (event: KeyboardEvent) => void;
  cellChangedCallback?: () => void;
  sharedModel?: { changed: { connect(cb: () => void): void; disconnect(cb: () => void): void } };
}

export class LockManager {
  private lockedNotebooks: Map<string, LockState> = new Map();
  private commandsWrapped = false;

  constructor(
    private notebookTracker: INotebookTracker,
    private app: JupyterFrontEnd,
  ) {
    this.installCommandBlocker();
  }

  /**
   * ノートブックをロックする
   */
  lockNotebook(notebookPath: string): void {
    console.log(`[LockManager] Locking notebook: ${notebookPath}`);

    const normalizedPath = normalizeNotebookPath(notebookPath);

    const notebookPanel = findNotebookByPath(this.notebookTracker, normalizedPath);
    if (!notebookPanel) {
      console.log(`[LockManager] Notebook not open: ${normalizedPath}`);
      return;
    }

    if (this.lockedNotebooks.has(normalizedPath)) {
      console.log(`[LockManager] Notebook already locked: ${normalizedPath}`);
      return;
    }

    try {
      // セル実行ショートカットをブロック
      const keydownHandler = this.createExecutionBlockHandler();
      notebookPanel.node.addEventListener('keydown', keydownHandler, true);

      // ロックインジケータを表示
      const indicator = new LockIndicator();
      notebookPanel.toolbar.addItem('ai-lock-indicator', indicator);

      // ロック状態を記録（setNotebookReadOnly より先に設定する。
      // setNotebookReadOnly 内で cellChangedCallback を保存するために必要）
      this.lockedNotebooks.set(normalizedPath, { indicator, keydownHandler });

      // セルエディタを read-only 化
      this.setNotebookReadOnly(notebookPanel, normalizedPath, true);

      console.log(`[LockManager] Notebook locked: ${normalizedPath}`);
    } catch (error) {
      console.error('[LockManager] Failed to lock notebook:', error);
    }
  }

  /**
   * ノートブックのロックを解除する
   */
  unlockNotebook(notebookPath: string): void {
    console.log(`[LockManager] Unlocking notebook: ${notebookPath}`);

    const normalizedPath = normalizeNotebookPath(notebookPath);

    const state = this.lockedNotebooks.get(normalizedPath);
    if (!state) {
      console.log(`[LockManager] Notebook not locked: ${normalizedPath}`);
      return;
    }

    const notebookPanel = findNotebookByPath(this.notebookTracker, normalizedPath);
    if (!notebookPanel) {
      console.log(`[LockManager] Notebook not open (but was locked): ${normalizedPath}`);
      this.lockedNotebooks.delete(normalizedPath);
      return;
    }

    try {
      // read-only を解除
      this.setNotebookReadOnly(notebookPanel, normalizedPath, false);

      // セル実行ショートカットのブロックを解除
      notebookPanel.node.removeEventListener('keydown', state.keydownHandler, true);

      // ロックインジケータを削除
      state.indicator.dispose();

      console.log(`[LockManager] Notebook unlocked: ${normalizedPath}`);
    } catch (error) {
      console.error('[LockManager] Failed to unlock notebook:', error);
    } finally {
      // 例外発生時もロック状態を確実に削除（操作不能状態を防止）
      this.lockedNotebooks.delete(normalizedPath);
    }
  }

  /**
   * WebSocket 切断時に全ノートブックのロックを解除する
   */
  unlockAll(): void {
    console.log('[LockManager] Unlocking all notebooks due to WebSocket disconnect');

    const paths = Array.from(this.lockedNotebooks.keys());

    for (const path of paths) {
      this.unlockNotebook(path);
    }
  }

  /**
   * app.commands.execute をラップし、ロック中ノートブックへのブロック対象コマンドを抑止する。
   * コンストラクタから一度だけ呼び出す（commandsWrapped フラグで idempotent ガード）。
   */
  private installCommandBlocker(): void {
    if (this.commandsWrapped) {
      return;
    }
    this.commandsWrapped = true;

    const commands = this.app.commands;
    const originalExecute = commands.execute.bind(commands);

    // CommandRegistry.execute は `execute<T>(id, args?) => Promise<T>` のジェネリック関数。
    // プロパティとして差し替えるため、ジェネリクスを除いた互換シグネチャで定義する。
    const wrapper = (id: string, args?: Parameters<typeof originalExecute>[1]): Promise<unknown> => {
      if (BLOCKED_COMMAND_IDS.has(id) && this.isCurrentNotebookLocked()) {
        console.warn('[LockManager] Blocked command:', id);
        return Promise.resolve(undefined);
      }
      return originalExecute(id, args);
    };

    // CommandRegistry は sealed ではないため execute を差し替え可能。
    // 型上は互換の `as unknown` キャストを経由して代入する。
    (commands as unknown as { execute: typeof wrapper }).execute = wrapper;
  }

  /**
   * 現在アクティブなノートブックがロック中かどうかを返す。
   */
  private isCurrentNotebookLocked(): boolean {
    const current = this.notebookTracker.currentWidget;
    if (!current) {
      return false;
    }
    const path = normalizeNotebookPath(current.context.path);
    return this.lockedNotebooks.has(path);
  }

  /**
   * ロック中にセル実行ショートカットをブロックするキーダウンハンドラを作成する。
   * capture フェーズで登録し、JupyterLab のコマンドシステムに到達させない。
   */
  private createExecutionBlockHandler(): (event: KeyboardEvent) => void {
    return (event: KeyboardEvent) => {
      if (event.key !== 'Enter') {
        return;
      }

      // Shift+Enter, Ctrl/Cmd+Enter, Alt/Option+Enter をブロック
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        console.log(
          `[LockManager] Blocked cell execution shortcut: ${event.key} (shift=${event.shiftKey}, ctrl=${event.ctrlKey}, meta=${event.metaKey}, alt=${event.altKey})`,
        );
      }
    };
  }

  /**
   * 全セルのエディタに readOnly を設定する
   */
  private setAllCellsReadOnly(notebookPanel: NotebookPanel, readOnly: boolean): void {
    for (const widget of notebookPanel.content.widgets) {
      const editor = widget.editor;
      if (editor) {
        editor.setOption('readOnly', readOnly);
      }
    }
  }

  /**
   * ノートブックの read-only 状態を設定する
   */
  private setNotebookReadOnly(notebookPanel: NotebookPanel, normalizedPath: string, readOnly: boolean): void {
    const notebook = notebookPanel.content;
    const model = notebook.model;

    if (!model) {
      console.error('[LockManager] Notebook model is null');
      return;
    }

    // 全セルの read-only を設定
    this.setAllCellsReadOnly(notebookPanel, readOnly);

    // 新しく追加されるセルにも read-only を適用するため、
    // sharedModel の changed シグナルを監視する
    if (readOnly) {
      const sharedModel = model.sharedModel;
      const callback = () => {
        // 新しく追加されたセルを read-only にする
        for (const widget of notebook.widgets) {
          const editor = widget.editor;
          if (editor && !editor.getOption('readOnly')) {
            editor.setOption('readOnly', true);
          }
        }
      };

      sharedModel.changed.connect(callback);

      // アンロック時に切断できるよう、コールバックを保存
      const state = this.lockedNotebooks.get(normalizedPath);
      if (state) {
        state.cellChangedCallback = callback;
        state.sharedModel = sharedModel;
      } else {
        console.warn(`[LockManager] LockState not found for path: ${normalizedPath}`);
      }
    } else {
      // アンロック時にシグナル監視を解除
      const state = this.lockedNotebooks.get(normalizedPath);
      if (state?.cellChangedCallback && state?.sharedModel) {
        state.sharedModel.changed.disconnect(state.cellChangedCallback);
      }
    }
  }
}
