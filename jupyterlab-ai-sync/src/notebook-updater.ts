/**
 * ノートブックUI更新ロジック
 *
 * タスク 21.3: 差分イベント配信を廃止し、notebook_changed → debounce 付き revert に置換。
 * cell_execute_start / cell_execute_end は ephemeral 通知として維持。
 */
import { INotebookTracker, NotebookPanel, Notebook } from '@jupyterlab/notebook';
import { CodeCell } from '@jupyterlab/cells';
import { ISharedCodeCell } from '@jupyter/ydoc';
import { INotebookModel } from '@jupyterlab/notebook';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { AiEvent } from './websocket-client';
import { LockManager } from './lock-manager';
import { findNotebookByPath } from './notebook-finder';

export interface NotebookChangedEvent extends AiEvent {
  type: 'notebook_changed';
  notebook_path: string;
  seq: number;
}

export interface CellExecuteStartEvent extends AiEvent {
  type: 'cell_execute_start';
  notebook_path: string;
  cell_index: number;
}

export interface CellExecuteEndEvent extends AiEvent {
  type: 'cell_execute_end';
  notebook_path: string;
  cell_index: number;
  execution_count: number;
  success: boolean;
}

export interface LockAcquiredEvent extends AiEvent {
  type: 'lock_acquired';
  notebook_path: string;
}

export interface LockReleasedEvent extends AiEvent {
  type: 'lock_released';
  notebook_path: string;
}

/** ノートブック単位の revert debounce 間隔（ミリ秒） */
const REVERT_DEBOUNCE_MS = 300;

export class NotebookUpdater {
  private lockManager: LockManager | null = null;
  /** ノートブックパスごとの debounce タイマー */
  private revertTimers: Map<string, number> = new Map();

  constructor(
    private notebookTracker: INotebookTracker,
    private docManager: IDocumentManager,
  ) {}

  /**
   * LockManager を設定する（plugin.ts から呼ばれる）
   */
  setLockManager(lockManager: LockManager): void {
    this.lockManager = lockManager;
  }

  /**
   * イベントを処理
   */
  handleEvent(event: AiEvent): void {
    // notebook_path の実行時型検証（全 5 イベント種が必要とする）
    const notebookPath = (event as { notebook_path?: string }).notebook_path;
    if (typeof notebookPath !== 'string') {
      console.warn(`[NotebookUpdater] Ignoring event with missing or invalid notebook_path: type=${event.type}`);
      return;
    }
    console.log(`[NotebookUpdater] Handling ${event.type} event for ${notebookPath}`);

    try {
      switch (event.type) {
        case 'notebook_changed':
          this.handleNotebookChanged(event as NotebookChangedEvent);
          break;
        case 'cell_execute_start':
          this.handleCellExecuteStart(event as CellExecuteStartEvent);
          break;
        case 'cell_execute_end':
          this.handleCellExecuteEnd(event as CellExecuteEndEvent);
          break;
        case 'lock_acquired':
          this.handleLockAcquired(event as LockAcquiredEvent);
          break;
        case 'lock_released':
          this.handleLockReleased(event as LockReleasedEvent);
          break;
        default:
          console.log('[NotebookUpdater] Unknown event type:', event.type);
      }
    } catch (error) {
      console.error(`[NotebookUpdater] Error handling ${event.type} event:`, error);
    }
  }

  /**
   * notebook_changed イベントを処理
   *
   * (a) findNotebookByPath で対象パネルを解決（未オープンなら無視）
   * (b) dirty かつ非ロック中ならスキップ + console.warn
   * (c) ノートブック単位 300ms trailing debounce で context.revert()
   */
  private handleNotebookChanged(event: NotebookChangedEvent): void {
    const panel = findNotebookByPath(this.notebookTracker, event.notebook_path);
    if (!panel) {
      // 未オープンなら無視
      return;
    }

    // dirty かつ非ロック中ならスキップ（ユーザーの未保存変更を保護）
    const isLocked = this.lockManager ? this.lockManager.isLocked(event.notebook_path) : false;
    if (panel.context.model.dirty && !isLocked) {
      console.warn(
        `[NotebookUpdater] Skipping revert for ${event.notebook_path}: notebook is dirty and not locked by AI`,
      );
      return;
    }

    // ノートブック単位 300ms trailing debounce で revert
    this.scheduleRevert(event.notebook_path, panel);
  }

  /**
   * debounce 付き revert をスケジュールする
   */
  private scheduleRevert(notebookPath: string, panel: NotebookPanel): void {
    // 既存タイマーをキャンセル
    const existingTimer = this.revertTimers.get(notebookPath);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.revertTimers.delete(notebookPath);
      this.executeRevert(notebookPath, panel);
    }, REVERT_DEBOUNCE_MS);

    this.revertTimers.set(notebookPath, timer);
  }

  /**
   * context.revert() でディスクから再読込する
   */
  private executeRevert(notebookPath: string, panel: NotebookPanel): void {
    try {
      const context = this.docManager.contextForWidget(panel);
      if (context) {
        context.revert().then(
          () => {
            console.log(`[NotebookUpdater] Reverted notebook from disk: ${notebookPath}`);
          },
          (error: unknown) => {
            console.error(`[NotebookUpdater] Failed to revert notebook ${notebookPath}:`, error);
          },
        );
      } else {
        console.error(`[NotebookUpdater] No context found for notebook: ${notebookPath}`);
      }
    } catch (error) {
      console.error(`[NotebookUpdater] Failed to revert notebook ${notebookPath}:`, error);
    }
  }

  /**
   * セル実行開始イベントを処理
   */
  private handleCellExecuteStart(event: CellExecuteStartEvent): void {
    const context = this.getNotebookAndModel(event.notebook_path);
    if (!context) {
      return;
    }

    try {
      const cellIndex = event.cell_index;
      const codeCellWidget = this.getCodeCellWidget(context.notebook, cellIndex);
      if (!codeCellWidget) {
        return;
      }

      // outputs をクリア（OutputAreaModel API に統一して双方向同期の循環を回避）
      codeCellWidget.outputArea.model.clear();
      // execution_count を null に設定（実行中を表す [*]）
      codeCellWidget.model.executionCount = null;

      // セルを trusted に設定（リッチ出力を表示するため）
      codeCellWidget.model.trusted = true;

      // 対象セルにスクロール
      this.activateAndScrollToCell(context.notebook, cellIndex);

      console.log(`[NotebookUpdater] Cell execution started at index ${cellIndex}`);
    } catch (error) {
      console.error('[NotebookUpdater] Failed to start cell execution:', error);
    }
  }

  /**
   * セル実行完了イベントを処理
   */
  private handleCellExecuteEnd(event: CellExecuteEndEvent): void {
    const context = this.getNotebookAndModel(event.notebook_path);
    if (!context) {
      return;
    }

    try {
      const codeCellWidget = this.getCodeCellWidget(context.notebook, event.cell_index);
      if (!codeCellWidget) {
        return;
      }

      // セルウィジェット経由で execution_count を設定
      codeCellWidget.model.executionCount = event.execution_count;

      // SharedModel にも反映（ファイル保存時の整合性維持のため）
      const sharedCodeCell = this.getSharedCodeCell(context.model, event.cell_index);
      if (sharedCodeCell) {
        sharedCodeCell.execution_count = event.execution_count;
      }

      console.log(
        `[NotebookUpdater] Cell execution completed at index ${event.cell_index}, count: ${event.execution_count}`,
      );
    } catch (error) {
      console.error('[NotebookUpdater] Failed to complete cell execution:', error);
    }
  }

  /**
   * ロック取得イベントを処理（サーバー側でロック取得成功時に配信される）。
   * ブラウザは該当ノートブックを readOnly 表示にする（UX への追従）。
   */
  private handleLockAcquired(event: LockAcquiredEvent): void {
    if (!this.lockManager) {
      console.error('[NotebookUpdater] LockManager not set');
      return;
    }

    this.lockManager.lockNotebook(event.notebook_path);
  }

  /**
   * ロック解放イベントを処理（サーバー側でロック解放・TTL 失効時に配信される）。
   * ブラウザは該当ノートブックの readOnly 表示を解除する。
   */
  private handleLockReleased(event: LockReleasedEvent): void {
    if (!this.lockManager) {
      console.error('[NotebookUpdater] LockManager not set');
      return;
    }

    this.lockManager.unlockNotebook(event.notebook_path);
  }

  /**
   * ノートブックパネルとモデルを取得（nullチェック済み）
   */
  private getNotebookAndModel(notebookPath: string): {
    notebook: Notebook;
    model: INotebookModel;
  } | null {
    const notebookPanel = findNotebookByPath(this.notebookTracker, notebookPath);
    if (!notebookPanel) {
      console.log(`[NotebookUpdater] Notebook not open: ${notebookPath}`);
      return null;
    }

    const notebook = notebookPanel.content;
    const model = notebook.model;
    if (!model) {
      console.error('[NotebookUpdater] Notebook model is null');
      return null;
    }

    return { notebook, model };
  }

  /**
   * セルウィジェットとコードセルを取得（nullチェック済み）
   */
  private getCodeCellWidget(notebook: Notebook, cellIndex: number): CodeCell | null {
    const cellWidget = notebook.widgets[cellIndex];
    if (!cellWidget || cellWidget.model.type !== 'code') {
      console.error(`[NotebookUpdater] Code cell widget not found at index ${cellIndex}`);
      return null;
    }
    return cellWidget as CodeCell;
  }

  /**
   * SharedModel のコードセルを取得（nullチェック済み）
   */
  private getSharedCodeCell(model: INotebookModel, cellIndex: number): ISharedCodeCell | null {
    const cell = model.sharedModel.getCell(cellIndex);
    if (!cell || cell.cell_type !== 'code') {
      console.error(`[NotebookUpdater] Code cell not found at index ${cellIndex}`);
      return null;
    }
    return cell as ISharedCodeCell;
  }

  /**
   * セルをアクティブにしてスクロール
   */
  private activateAndScrollToCell(notebook: Notebook, cellIndex: number): void {
    notebook.activeCellIndex = cellIndex;
    notebook.scrollToItem(cellIndex);
  }
}
