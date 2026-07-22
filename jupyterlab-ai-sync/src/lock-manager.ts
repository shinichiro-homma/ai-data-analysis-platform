/**
 * ノートブックロック管理
 */
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { JupyterFrontEnd } from '@jupyterlab/application';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { LockIndicator } from './ui/lock-indicator';
import { normalizeNotebookPath } from './path-utils';
import { findNotebookByPath } from './notebook-finder';

/**
 * ロック中でもユーザー操作を許可するコマンド ID（allowlist）。
 *
 * ここに ID を追加すると、以下が自動的に適用される:
 * 1. isEnabled ガードが BLOCKED_COMMAND_IDS 判定をスキップし元の isEnabled に委譲する
 * 2. lockNotebook が notebook を command mode + container focus に維持し、
 *    exempt コマンドのキーボードショートカットが発火可能な UI 状態を保つ
 *
 * 将来的にロック対象外とする機能を追加する際は、このセットに ID を追加するだけで済む。
 */
export const LOCK_EXEMPT_COMMAND_IDS = new Set<string>(['notebook:interrupt-kernel', 'kernelmenu:interrupt']);

/**
 * ロック中にブロックするコマンド ID セット。
 * カーネル中断（notebook:interrupt-kernel / kernelmenu:interrupt）は F3.3 の要件により含めない。
 * カーネル再起動はロック中に許可すべきでない（kernel 状態破壊と AI との競合を防ぐため）。
 */
export const BLOCKED_COMMAND_IDS = new Set<string>([
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
  // カーネル再起動（ロック中は禁止）
  'notebook:restart-kernel',
  'notebook:restart-clear-output',
  'kernelmenu:restart',
  'kernelmenu:restart-clear',
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

/**
 * commands.isEnabled をラップするガード関数を生成する。
 * ロック中のブロック対象コマンドに対して false を返し、それ以外は元の isEnabled に委譲する。
 */
export function createIsEnabledGuard(
  isCurrentNotebookLocked: () => boolean,
  originalIsEnabled: (id: string, args?: ReadonlyPartialJSONObject) => boolean,
): (id: string, args?: ReadonlyPartialJSONObject) => boolean {
  return (id: string, args?: ReadonlyPartialJSONObject): boolean => {
    // exempt コマンドは常に元の isEnabled に委譲
    if (LOCK_EXEMPT_COMMAND_IDS.has(id)) {
      return originalIsEnabled(id, args);
    }
    // ブロック対象コマンドかつロック中は false を返す
    if (BLOCKED_COMMAND_IDS.has(id) && isCurrentNotebookLocked()) {
      return false;
    }
    // それ以外は元の isEnabled に委譲
    return originalIsEnabled(id, args);
  };
}

interface LockState {
  indicator: LockIndicator;
  cellChangedCallback?: () => void;
  sharedModel?: { changed: { connect(cb: () => void): void; disconnect(cb: () => void): void } };
  modeChangedDisposer?: () => void;
}

export class LockManager {
  private lockedNotebooks: Map<string, LockState> = new Map();

  constructor(
    private notebookTracker: INotebookTracker,
    private app: JupyterFrontEnd,
  ) {
    this.installIsEnabledGuard();
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
      // ロックインジケータを表示
      const indicator = new LockIndicator();
      notebookPanel.toolbar.addItem('ai-lock-indicator', indicator);

      // ロック状態を記録（setNotebookReadOnly より先に設定する。
      // setNotebookReadOnly 内で cellChangedCallback を保存するために必要）
      this.lockedNotebooks.set(normalizedPath, { indicator });

      // セルエディタを read-only 化
      this.setNotebookReadOnly(notebookPanel, normalizedPath, true);

      // exempt コマンドのキーボードショートカット（例: notebook:interrupt-kernel の I I）は
      // JupyterLab 4.x では .jp-Notebook:focus + command mode を前提に登録されているため、
      // ロック中は以下を維持する。
      notebookPanel.content.mode = 'command';
      notebookPanel.content.node.focus();

      const onStateChanged = (_sender: unknown, args: { name: string }) => {
        if (args.name === 'mode' && notebookPanel.content.mode === 'edit') {
          notebookPanel.content.mode = 'command';
        }
      };
      notebookPanel.content.stateChanged.connect(onStateChanged);

      const state = this.lockedNotebooks.get(normalizedPath);
      if (state) {
        state.modeChangedDisposer = () => {
          notebookPanel.content.stateChanged.disconnect(onStateChanged);
        };
      }

      // ロック状態の変更をコマンドシステムに通知し、isEnabled ガードを再評価させる
      this.app.commands.notifyCommandChanged();

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
      this.app.commands.notifyCommandChanged();
      return;
    }

    try {
      // read-only を解除
      this.setNotebookReadOnly(notebookPanel, normalizedPath, false);

      // mode 変更監視を解除
      state.modeChangedDisposer?.();

      // ロックインジケータを削除
      state.indicator.dispose();

      console.log(`[LockManager] Notebook unlocked: ${normalizedPath}`);
    } catch (error) {
      console.error('[LockManager] Failed to unlock notebook:', error);
    } finally {
      // 例外発生時もロック状態を確実に削除（操作不能状態を防止）
      this.lockedNotebooks.delete(normalizedPath);
      // アンロック状態の変更をコマンドシステムに通知し、isEnabled ガードを再評価させる
      this.app.commands.notifyCommandChanged();
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
   * commands.isEnabled を createIsEnabledGuard でラップし、
   * ロック中ノートブックへのブロック対象コマンドを UI 全経路で無効化する。
   * コンストラクタから一度だけ呼び出す。
   */
  private installIsEnabledGuard(): void {
    const commands = this.app.commands;
    const originalIsEnabled = commands.isEnabled.bind(commands);

    const guard = createIsEnabledGuard(() => this.isCurrentNotebookLocked(), originalIsEnabled);

    // CommandRegistry は sealed ではないため isEnabled を差し替え可能。
    // 型上は互換の `as unknown` キャストを経由して代入する。
    (commands as unknown as { isEnabled: typeof guard }).isEnabled = guard;

    // 初期状態を反映
    this.app.commands.notifyCommandChanged();
  }

  /**
   * 指定パスのノートブックがロック中かどうかを返す。
   */
  isLocked(notebookPath: string): boolean {
    const normalizedPath = normalizeNotebookPath(notebookPath);
    return this.lockedNotebooks.has(normalizedPath);
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
