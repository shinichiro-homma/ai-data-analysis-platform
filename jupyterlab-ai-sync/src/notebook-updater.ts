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
import { z } from 'zod';
import { AiEvent } from './websocket-client';
import { LockManager } from './lock-manager';
import { findNotebookByPath } from './notebook-finder';
import { normalizeNotebookPath } from './path-utils';

// --- zod スキーマ（プロセス境界の受信データをランタイム検証する） ---
export const NotebookChangedEventSchema = z.object({
  type: z.literal('notebook_changed'),
  notebook_path: z.string(),
  seq: z.number(),
});
export type NotebookChangedEvent = z.infer<typeof NotebookChangedEventSchema>;

export const CellExecuteStartEventSchema = z.object({
  type: z.literal('cell_execute_start'),
  notebook_path: z.string(),
  cell_index: z.number(),
});
export type CellExecuteStartEvent = z.infer<typeof CellExecuteStartEventSchema>;

export const CellExecuteEndEventSchema = z.object({
  type: z.literal('cell_execute_end'),
  notebook_path: z.string(),
  cell_index: z.number(),
  execution_count: z.number(),
  success: z.boolean(),
});
export type CellExecuteEndEvent = z.infer<typeof CellExecuteEndEventSchema>;

export const LockAcquiredEventSchema = z.object({
  type: z.literal('lock_acquired'),
  notebook_path: z.string(),
});
export type LockAcquiredEvent = z.infer<typeof LockAcquiredEventSchema>;

export const LockReleasedEventSchema = z.object({
  type: z.literal('lock_released'),
  notebook_path: z.string(),
});
export type LockReleasedEvent = z.infer<typeof LockReleasedEventSchema>;

/** 同期状態照会レスポンスの zod スキーマ */
const SyncStateLockSchema = z.object({
  notebook_path: z.string(),
  expires_at: z.number(),
});

export const SyncStateResponseSchema = z.object({
  notebooks: z.record(z.string(), z.number()),
  locks: z.array(SyncStateLockSchema),
});
type SyncStateResponse = z.infer<typeof SyncStateResponseSchema>;

/**
 * 同期状態照会 API を呼び出す。
 * ServerConnection.makeSettings + makeRequest を使用する。
 */
async function fetchSyncState(): Promise<SyncStateResponse | null> {
  const settings = ServerConnection.makeSettings();
  const url = URLExt.join(settings.baseUrl, 'api/ai/sync-state');
  const response = await ServerConnection.makeRequest(url, {}, settings);
  if (!response.ok) {
    throw new Error(`fetchSyncState failed: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  // レスポンスは {"data": {notebooks, locks}} 形式
  const result = SyncStateResponseSchema.safeParse(json.data);
  if (!result.success) {
    console.warn('[NotebookUpdater] fetchSyncState: invalid response:', result.error.message);
    return null;
  }
  return result.data;
}

/** ノートブック単位の revert debounce 間隔（ミリ秒） */
export const REVERT_DEBOUNCE_MS = 300;

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
   * 指定パスの pending revert タイマーをキャンセルする。
   * ephemeral イベント（cell_execute_start/end）到着時に呼ばれ、
   * revert によるちらつきを防ぐ。
   */
  cancelPendingRevert(notebookPath: string): void {
    const existingTimer = this.revertTimers.get(notebookPath);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      this.revertTimers.delete(notebookPath);
    }
  }

  /**
   * 全タイマーと seq 情報をクリアする（プラグイン破棄時）。
   */
  dispose(): void {
    for (const timer of this.revertTimers.values()) {
      window.clearTimeout(timer);
    }
    this.revertTimers.clear();
    this.lastSeq.clear();
  }

  private parseEventOrWarn<T>(schema: z.ZodType<T>, event: AiEvent, label: string): T | null {
    const result = schema.safeParse(event);
    if (!result.success) {
      console.warn(`[NotebookUpdater] Invalid ${label} event:`, result.error.message);
      return null;
    }
    return result.data;
  }

  /**
   * イベントを処理
   */
  handleEvent(event: AiEvent): void {
    if (!event || typeof event !== 'object') {
      console.warn('[NotebookUpdater] Ignoring non-object event');
      return;
    }

    console.log(`[NotebookUpdater] Handling ${event.type} event`);

    try {
      switch (event.type) {
        case 'notebook_changed': {
          const data = this.parseEventOrWarn(NotebookChangedEventSchema, event, 'notebook_changed');
          if (!data) return;
          this.handleNotebookChanged(data);
          break;
        }
        case 'cell_execute_start': {
          const data = this.parseEventOrWarn(CellExecuteStartEventSchema, event, 'cell_execute_start');
          if (!data) return;
          this.handleCellExecuteStart(data);
          break;
        }
        case 'cell_execute_end': {
          const data = this.parseEventOrWarn(CellExecuteEndEventSchema, event, 'cell_execute_end');
          if (!data) return;
          this.handleCellExecuteEnd(data);
          break;
        }
        case 'lock_acquired': {
          const data = this.parseEventOrWarn(LockAcquiredEventSchema, event, 'lock_acquired');
          if (!data) return;
          this.handleLockAcquired(data);
          break;
        }
        case 'lock_released': {
          const data = this.parseEventOrWarn(LockReleasedEventSchema, event, 'lock_released');
          if (!data) return;
          this.handleLockReleased(data);
          break;
        }
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
    this.scheduleRevert(event.notebook_path, event.seq);
  }

  /**
   * debounce 付き revert をスケジュールする
   */
  private scheduleRevert(notebookPath: string, seq: number): void {
    this.cancelPendingRevert(notebookPath);

    const timer = window.setTimeout(() => {
      this.revertTimers.delete(notebookPath);
      this.executeRevert(notebookPath, seq);
    }, REVERT_DEBOUNCE_MS);

    this.revertTimers.set(notebookPath, timer);
  }

  /**
   * context.revert() でディスクから再読込する。
   * 発火時に panel を再解決し、クローズ済みならスキップする。
   * seq <= lastSeq を再チェックし、revert 成功時に lastSeq を更新する。
   */
  private executeRevert(notebookPath: string, seq: number): void {
    const normalizedPath = normalizeNotebookPath(notebookPath);
    const knownSeq = this.lastSeq.get(normalizedPath) ?? 0;

    // debounce 中に保存完了フック等で lastSeq が更新された場合の吸収
    if (seq <= knownSeq) {
      console.log(
        `[NotebookUpdater] Skipping revert at fire time for ${notebookPath}: seq ${seq} <= lastSeq ${knownSeq}`,
      );
      return;
    }

    // panel を再解決（debounce 中にパネルが閉じられた場合はスキップ）
    const panel = findNotebookByPath(this.notebookTracker, notebookPath);
    if (!panel) {
      console.log(`[NotebookUpdater] Panel closed, skipping revert for ${notebookPath}`);
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
   * pending revert がある場合はキャンセルする（ちらつき防止）。
   */
  private handleCellExecuteStart(event: CellExecuteStartEvent): void {
    this.cancelPendingRevert(normalizeNotebookPath(event.notebook_path));

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
   * pending revert がある場合はキャンセルする（ちらつき防止）。
   */
  private handleCellExecuteEnd(event: CellExecuteEndEvent): void {
    this.cancelPendingRevert(normalizeNotebookPath(event.notebook_path));

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
    let syncState: SyncStateResponse | null;
    try {
      syncState = await fetchSyncState();
    } catch (error) {
      console.warn('[NotebookUpdater] resync: failed to fetch sync state, skipping', error);
      return;
    }
    if (!syncState) {
      console.warn('[NotebookUpdater] resync: invalid sync state response, skipping');
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
      const normalizedPath = normalizeNotebookPath(panel.context.path);

      // パネル破棄時にタイマーと seq をクリーンアップ
      panel.disposed.connect(() => {
        this.cancelPendingRevert(normalizedPath);
        this.lastSeq.delete(normalizedPath);
      });

      panel.context.saveState.connect((_context, state) => {
        if (state === 'completed') {
          const path = normalizeNotebookPath(panel.context.path);
          fetchSyncState()
            .then((syncState) => {
              if (!syncState) {
                console.warn(`[NotebookUpdater] Save completed but sync state response was invalid for ${path}`);
                return;
              }
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
