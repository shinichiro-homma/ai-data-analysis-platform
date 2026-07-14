/**
 * ノートブックUI更新ロジック
 *
 * タスク 21.3: 差分イベント配信を廃止し、notebook_changed → debounce 付き revert に置換。
 * タスク 21.4: 再接続時の再同期。seq ベースの revert 判定、dirty 復元、resync()。
 * cell_execute_start / cell_execute_end は ephemeral 通知として維持。
 */
import { INotebookTracker, NotebookPanel, Notebook } from '@jupyterlab/notebook';
import { CodeCell } from '@jupyterlab/cells';
import { ISharedCodeCell } from '@jupyter/ydoc';
import { INotebookModel } from '@jupyterlab/notebook';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { ServerConnection } from '@jupyterlab/services';
import { URLExt } from '@jupyterlab/coreutils';
import { AiEvent } from './websocket-client';
import { LockManager } from './lock-manager';
import { findNotebookByPath } from './notebook-finder';
import { normalizeNotebookPath } from './path-utils';

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

/** 同期状態照会レスポンスの型 */
interface SyncStateLock {
  notebook_path: string;
  expires_at: number;
}

interface SyncStateResponse {
  notebooks: Record<string, number>;
  locks: SyncStateLock[];
}

/**
 * 同期状態照会 API を呼び出す。
 * ServerConnection.makeSettings + makeRequest を使用する。
 */
async function fetchSyncState(): Promise<SyncStateResponse> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, 'api/ai/sync-state');
  const response = await ServerConnection.makeRequest(url, {}, settings);
  if (!response.ok) {
    throw new Error(`fetchSyncState failed: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  // レスポンスは {"data": {notebooks, locks}} 形式
  return json.data as SyncStateResponse;
}

/** ノートブック単位の revert debounce 間隔（ミリ秒） */
const REVERT_DEBOUNCE_MS = 300;

export class NotebookUpdater {
  private lockManager: LockManager | null = null;
  /** ノートブックパスごとの debounce タイマー */
  private revertTimers: Map<string, number> = new Map();
  /** ノートブックパス（normalizeNotebookPath 済み）ごとの最終既知 seq */
  private lastSeq: Map<string, number> = new Map();

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
   * seq ベースで revert 要否を判定する（指摘 1: dirty && !isLocked ガード廃止）。
   * - seq <= lastSeq → 既知の更新なのでスキップ
   * - dirty → スキップ + 競合の warn（lastSeq は据え置き）
   * - それ以外 → scheduleRevert(path, panel, seq)
   */
  private handleNotebookChanged(event: NotebookChangedEvent): void {
    const panel = findNotebookByPath(this.notebookTracker, event.notebook_path);
    if (!panel) {
      // 未オープンなら無視
      return;
    }

    const normalizedPath = normalizeNotebookPath(event.notebook_path);
    const knownSeq = this.lastSeq.get(normalizedPath) ?? 0;

    // seq <= lastSeq: 既知の更新（自己エコー等）なのでスキップ
    if (event.seq <= knownSeq) {
      console.log(
        `[NotebookUpdater] Skipping revert for ${event.notebook_path}: seq ${event.seq} <= lastSeq ${knownSeq}`,
      );
      return;
    }

    // dirty: ユーザーの未保存変更を保護。lastSeq は据え置き（次の revert 機会に回す）
    if (panel.context.model.dirty) {
      console.warn(
        `[NotebookUpdater] Skipping revert for ${event.notebook_path}: notebook is dirty (seq ${event.seq}, conflict)`,
      );
      return;
    }

    // ノートブック単位 300ms trailing debounce で revert
    this.scheduleRevert(event.notebook_path, panel, event.seq);
  }

  /**
   * debounce 付き revert をスケジュールする
   */
  private scheduleRevert(notebookPath: string, panel: NotebookPanel, seq: number): void {
    // 既存タイマーをキャンセル
    const existingTimer = this.revertTimers.get(notebookPath);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      this.revertTimers.delete(notebookPath);
      this.executeRevert(notebookPath, panel, seq);
    }, REVERT_DEBOUNCE_MS);

    this.revertTimers.set(notebookPath, timer);
  }

  /**
   * context.revert() でディスクから再読込する。
   * 発火時に seq <= lastSeq を再チェックし、revert 成功時に lastSeq を更新する。
   */
  private executeRevert(notebookPath: string, panel: NotebookPanel, seq: number): void {
    const normalizedPath = normalizeNotebookPath(notebookPath);
    const knownSeq = this.lastSeq.get(normalizedPath) ?? 0;

    // debounce 中に保存完了フック等で lastSeq が更新された場合の吸収
    if (seq <= knownSeq) {
      console.log(
        `[NotebookUpdater] Skipping revert at fire time for ${notebookPath}: seq ${seq} <= lastSeq ${knownSeq}`,
      );
      return;
    }

    try {
      const context = this.docManager.contextForWidget(panel);
      if (context) {
        context.revert().then(
          () => {
            this.lastSeq.set(normalizedPath, seq);
            console.log(`[NotebookUpdater] Reverted notebook from disk: ${notebookPath} (seq=${seq})`);
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
   * セル実行開始イベントを処理。
   * ephemeral 更新で dirty を汚染しないよう、変更前の dirty を退避し変更後に復元する。
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

      // dirty を退避
      const wasDirty = context.model.dirty;

      // outputs をクリア（OutputAreaModel API に統一して双方向同期の循環を回避）
      codeCellWidget.outputArea.model.clear();
      // execution_count を null に設定（実行中を表す [*]）
      codeCellWidget.model.executionCount = null;

      // セルを trusted に設定（リッチ出力を表示するため）
      codeCellWidget.model.trusted = true;

      // dirty を復元（ephemeral 更新は dirty を汚染しない）
      context.model.dirty = wasDirty;

      // 対象セルにスクロール
      this.activateAndScrollToCell(context.notebook, cellIndex);

      console.log(`[NotebookUpdater] Cell execution started at index ${cellIndex}`);
    } catch (error) {
      console.error('[NotebookUpdater] Failed to start cell execution:', error);
    }
  }

  /**
   * セル実行完了イベントを処理。
   * ephemeral 更新で dirty を汚染しないよう、変更前の dirty を退避し変更後に復元する。
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

      // dirty を退避
      const wasDirty = context.model.dirty;

      // セルウィジェット経由で execution_count を設定
      codeCellWidget.model.executionCount = event.execution_count;

      // SharedModel にも反映（ファイル保存時の整合性維持のため）
      const sharedCodeCell = this.getSharedCodeCell(context.model, event.cell_index);
      if (sharedCodeCell) {
        sharedCodeCell.execution_count = event.execution_count;
      }

      // dirty を復元（ephemeral 更新は dirty を汚染しない）
      context.model.dirty = wasDirty;

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
   * 再接続時の再同期。照会 API で最新 seq とロック一覧を取得し、
   * 開いているノートブックの状態を回復する。冪等。
   *
   * - serverSeq !== lastSeq かつ !dirty → revert + lastSeq 更新
   * - serverSeq !== lastSeq かつ dirty → warn スキップ
   * - サーバーのロック一覧にあるパス → lockNotebook
   * - サーバーのロック一覧にないのにブラウザ側で isLocked → unlockNotebook
   *
   * サーバーのロックキーは正規化済みであり、ブラウザ側のキーも同一イベント由来の
   * パスで構築されるため、キー正規化基準は一致する前提。
   */
  async resync(): Promise<void> {
    let syncState: SyncStateResponse;
    try {
      syncState = await fetchSyncState();
    } catch (error) {
      console.warn('[NotebookUpdater] resync: failed to fetch sync state, skipping', error);
      return;
    }

    console.log('[NotebookUpdater] resync: received sync state', syncState);

    // ノートブックの revert
    for (const [path, serverSeq] of Object.entries(syncState.notebooks)) {
      const normalizedPath = normalizeNotebookPath(path);
      const knownSeq = this.lastSeq.get(normalizedPath) ?? 0;

      if (serverSeq === knownSeq) {
        continue;
      }

      const panel = findNotebookByPath(this.notebookTracker, path);
      if (!panel) {
        // 開いていないノートブックは lastSeq だけ更新
        this.lastSeq.set(normalizedPath, serverSeq);
        continue;
      }

      if (panel.context.model.dirty) {
        console.warn(
          `[NotebookUpdater] resync: skipping revert for ${path}: notebook is dirty (serverSeq=${serverSeq}, knownSeq=${knownSeq})`,
        );
        continue;
      }

      try {
        const context = this.docManager.contextForWidget(panel);
        if (context) {
          await context.revert();
          this.lastSeq.set(normalizedPath, serverSeq);
          console.log(`[NotebookUpdater] resync: reverted ${path} (seq=${serverSeq})`);
        }
      } catch (error) {
        console.error(`[NotebookUpdater] resync: failed to revert ${path}:`, error);
      }
    }

    // ロック状態の再適用
    if (this.lockManager) {
      const serverLockedPaths = new Set(syncState.locks.map((lock) => normalizeNotebookPath(lock.notebook_path)));

      // サーバーでロックされているパスをロック
      for (const lockedPath of serverLockedPaths) {
        this.lockManager.lockNotebook(lockedPath);
      }

      // サーバーにないのにブラウザでロックされているパスをアンロック
      // notebookTracker の全ウィジェットを走査
      this.notebookTracker.forEach((widget) => {
        const widgetPath = normalizeNotebookPath(widget.context.path);
        if (this.lockManager!.isLocked(widgetPath) && !serverLockedPaths.has(widgetPath)) {
          this.lockManager!.unlockNotebook(widgetPath);
        }
      });
    }
  }

  /**
   * 保存完了フックを設定する。
   * notebookTracker.widgetAdded で各パネルの context.saveState を監視し、
   * 'completed' で照会 API から seq を取得して lastSeq に記録する。
   * これにより自己保存のエコーイベントによる誤 revert を防ぐ（指摘 2）。
   */
  setupSaveHook(): void {
    this.notebookTracker.widgetAdded.connect((_sender: INotebookTracker, panel: NotebookPanel) => {
      panel.context.saveState.connect((_context, state) => {
        if (state === 'completed') {
          const path = normalizeNotebookPath(panel.context.path);
          fetchSyncState()
            .then((syncState) => {
              const serverSeq = syncState.notebooks[path];
              if (serverSeq !== undefined) {
                this.lastSeq.set(path, serverSeq);
                console.log(`[NotebookUpdater] Save completed, updated lastSeq for ${path} to ${serverSeq}`);
              }
            })
            .catch((error) => {
              console.warn(`[NotebookUpdater] Failed to fetch sync state after save for ${path}:`, error);
            });
        }
      });
    });
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
