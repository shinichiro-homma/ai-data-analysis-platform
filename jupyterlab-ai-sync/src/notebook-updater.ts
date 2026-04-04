/**
 * ノートブックUI更新ロジック
 */
import { INotebookTracker, NotebookPanel, Notebook } from '@jupyterlab/notebook';
import { Cell, CodeCell } from '@jupyterlab/cells';
import { ISharedCodeCell } from '@jupyter/ydoc';
import { INotebookModel } from '@jupyterlab/notebook';
import { IOutput, IMimeBundle } from '@jupyterlab/nbformat';
import { AiEvent } from './websocket-client';
import { LockManager } from './lock-manager';
import { findNotebookByPath } from './notebook-finder';

export interface CellAddedEvent extends AiEvent {
  type: 'cell_added';
  notebook_path: string;
  cell: {
    cell_type: 'code' | 'markdown';
    source: string;
  };
  index: number;
}

export interface CellExecuteStartEvent extends AiEvent {
  type: 'cell_execute_start';
  notebook_path: string;
  cell_index: number;
}

export interface CellOutputEvent extends AiEvent {
  type: 'cell_output';
  notebook_path: string;
  cell_index: number;
  output: {
    output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
    [key: string]: unknown;
  };
}

export interface CellExecuteEndEvent extends AiEvent {
  type: 'cell_execute_end';
  notebook_path: string;
  cell_index: number;
  execution_count: number;
  success: boolean;
}

export interface AiEditStartEvent extends AiEvent {
  type: 'ai_edit_start';
  notebook_path: string;
}

export interface AiEditEndEvent extends AiEvent {
  type: 'ai_edit_end';
  notebook_path: string;
}

export class NotebookUpdater {
  private lockManager: LockManager | null = null;

  constructor(private notebookTracker: INotebookTracker) {}

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
    switch (event.type) {
      case 'cell_added':
        this.handleCellAdded(event as CellAddedEvent);
        break;
      case 'cell_execute_start':
        this.handleCellExecuteStart(event as CellExecuteStartEvent);
        break;
      case 'cell_output':
        this.handleCellOutput(event as CellOutputEvent);
        break;
      case 'cell_execute_end':
        this.handleCellExecuteEnd(event as CellExecuteEndEvent);
        break;
      case 'ai_edit_start':
        this.handleAiEditStart(event as AiEditStartEvent);
        break;
      case 'ai_edit_end':
        this.handleAiEditEnd(event as AiEditEndEvent);
        break;
      default:
        console.log('[NotebookUpdater] Unknown event type:', event.type);
    }
  }

  /**
   * セル追加イベントを処理
   */
  private handleCellAdded(event: CellAddedEvent): void {
    console.log('[NotebookUpdater] Handling cell_added event:', event);

    const context = this.getNotebookAndModel(event.notebook_path);
    if (!context) {
      return;
    }

    console.log(`[NotebookUpdater] Found notebook: ${event.notebook_path}`);

    try {
      const cellType = event.cell.cell_type || 'code';
      const source = event.cell.source || '';
      const index = event.index;

      // セルを挿入（JupyterLab 4.x の API を使用）
      const sharedModel = context.model.sharedModel;

      // JupyterLab がデフォルトで追加する空セルを検出して置換する。
      // JupyterLab は空のノートブックを開くとデフォルトで空のコードセルを1つ追加する。
      // この空セルは SharedModel にのみ存在し（ディスク上には存在しない）、
      // MCP サーバーのセルインデックスとブラウザのインデックスがずれる原因になる。
      // そのため、最初のセル追加時にデフォルト空セルを置換してインデックスを揃える。
      if (sharedModel.cells.length === 1) {
        const existingCell = sharedModel.getCell(0);
        if (existingCell && existingCell.source.trim() === '' && existingCell.cell_type === 'code') {
          // デフォルト空セルを削除してから新しいセルを挿入
          sharedModel.deleteCell(0);
          sharedModel.insertCell(0, {
            cell_type: cellType,
            source: source,
            metadata: {},
          });
          console.log(`[NotebookUpdater] Replaced default empty cell at index 0`);
          this.activateAndScrollToCell(context.notebook, 0);
          return;
        }
      }

      // index が負の値（-1 = 末尾）の場合は末尾に追加
      const insertIndex = index < 0 ? sharedModel.cells.length : Math.min(index, sharedModel.cells.length);

      sharedModel.insertCell(insertIndex, {
        cell_type: cellType,
        source: source,
        metadata: {},
      });

      console.log(`[NotebookUpdater] Cell added at index ${insertIndex}`);

      // 追加されたセルにスクロール
      this.activateAndScrollToCell(context.notebook, insertIndex);
    } catch (error) {
      // セル追加失敗時もエラー通知はせず、ログのみ（ノートブックをリロードすればセルは反映される）
      console.error('[NotebookUpdater] Failed to add cell:', error);
    }
  }

  /**
   * セル実行開始イベントを処理
   */
  private handleCellExecuteStart(event: CellExecuteStartEvent): void {
    console.log('[NotebookUpdater] Handling cell_execute_start event:', event);

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
   * セル出力イベントを処理
   */
  private handleCellOutput(event: CellOutputEvent): void {
    console.log('[NotebookUpdater] Handling cell_output event:', event);

    const context = this.getNotebookAndModel(event.notebook_path);
    if (!context) {
      return;
    }

    try {
      const codeCellWidget = this.getCodeCellWidget(context.notebook, event.cell_index);
      if (!codeCellWidget) {
        return;
      }

      const outputArea = codeCellWidget.outputArea;
      if (!outputArea) {
        console.error(`[NotebookUpdater] OutputArea not found for cell ${event.cell_index}`);
        return;
      }

      // output を nbformat の IOutput 形式に変換
      const output = this.convertToNbformatOutput(event.output);
      if (!output) {
        return;
      }

      // OutputArea.model に直接追加（これがUI更新をトリガーする）
      // 注: JupyterLab 4.x では OutputAreaModel.add() は SharedModel に自動反映されない。
      // SharedModel への書き戻しは handleCellExecuteEnd で一括して行う。
      outputArea.model.add(output);

      console.log(`[NotebookUpdater] Output added to cell ${event.cell_index}`);
    } catch (error) {
      console.error('[NotebookUpdater] Failed to add cell output:', error);
    }
  }

  /**
   * セル実行完了イベントを処理
   */
  private handleCellExecuteEnd(event: CellExecuteEndEvent): void {
    console.log('[NotebookUpdater] Handling cell_execute_end event:', event);

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

        // OutputArea に蓄積された出力を SharedModel に書き戻す。
        // JupyterLab 4.x では OutputAreaModel.add() は SharedModel に自動反映されないため、
        // ここで明示的に setOutputs() を呼んで永続化する。
        const outputs = codeCellWidget.outputArea.model.toJSON();
        sharedCodeCell.setOutputs(outputs);
        console.log(
          `[NotebookUpdater] Persisted ${outputs.length} outputs to SharedModel for cell ${event.cell_index}`,
        );
      }

      console.log(
        `[NotebookUpdater] Cell execution completed at index ${event.cell_index}, count: ${event.execution_count}`,
      );
    } catch (error) {
      console.error('[NotebookUpdater] Failed to complete cell execution:', error);
    }
  }

  /**
   * イベントの出力を nbformat の IOutput 形式に変換
   */
  private convertToNbformatOutput(output: CellOutputEvent['output']): IOutput | null {
    switch (output.output_type) {
      case 'stream':
        return {
          output_type: 'stream',
          name: output.name as 'stdout' | 'stderr',
          text: output.text as string | string[],
        } as IOutput;
      case 'display_data':
        return {
          output_type: 'display_data',
          data: (output.data ?? {}) as IMimeBundle,
          metadata: (output.metadata ?? {}) as Record<string, unknown>,
        } as IOutput;
      case 'execute_result':
        return {
          output_type: 'execute_result',
          execution_count: output.execution_count as number | null,
          data: (output.data ?? {}) as IMimeBundle,
          metadata: (output.metadata ?? {}) as Record<string, unknown>,
        } as IOutput;
      case 'error':
        return {
          output_type: 'error',
          ename: output.ename as string,
          evalue: output.evalue as string,
          traceback: output.traceback as string[],
        } as IOutput;
      default:
        return null;
    }
  }

  /**
   * AI編集開始イベントを処理
   */
  private handleAiEditStart(event: AiEditStartEvent): void {
    console.log('[NotebookUpdater] Handling ai_edit_start event:', event);

    if (!this.lockManager) {
      console.error('[NotebookUpdater] LockManager not set');
      return;
    }

    this.lockManager.lockNotebook(event.notebook_path);
  }

  /**
   * AI編集終了イベントを処理
   */
  private handleAiEditEnd(event: AiEditEndEvent): void {
    console.log('[NotebookUpdater] Handling ai_edit_end event:', event);

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
    notebookPanel: NotebookPanel;
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

    return { notebookPanel, notebook, model };
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
