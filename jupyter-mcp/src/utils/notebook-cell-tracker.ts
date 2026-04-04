/**
 * ノートブックごとのセル数をインメモリで追跡するモジュール
 *
 * notebook_add_cell が返す cell_index を execute_code に渡すことで、
 * ディスク反映遅延によるセルインデックスのズレを防ぐ。
 */

import { getContentsWithTimeout } from './notebook-helpers.js';

/** ノートブックパス → セル数のマッピング */
const cellCounts = new Map<string, number>();

/** ノートブックパス → (コード → セルインデックス) のマッピング
 * notebook_add_cell で追加されたがまだディスクに反映されていないセルを追跡する。
 * execute_code の resolveOrCreateCell がディスク検索で見つけられないセルの重複作成を防ぐ。
 */
const pendingCells = new Map<string, Map<string, number>>();

/** Map エントリの上限（メモリリーク防止） */
const MAX_ENTRIES = 1000;

/** ペンディングセルのノートブックごとの上限 */
const MAX_PENDING_PER_NOTEBOOK = 100;

/**
 * ノートブックの有効セル数を取得する。
 * ディスク上のセル数とメモリ上の追跡値の大きい方を返す。
 */
export async function getEffectiveCellCount(notebookPath: string): Promise<number> {
  let diskCellCount = 0;
  try {
    const notebook = await getContentsWithTimeout(notebookPath);
    diskCellCount = notebook.content.cells.length;
  } catch (error) {
    console.warn(
      '[notebook-cell-tracker] Failed to read notebook from disk:',
      error instanceof Error ? error.message : error,
    );
  }

  const memoryCellCount = cellCounts.get(notebookPath) ?? 0;
  return Math.max(diskCellCount, memoryCellCount);
}

/**
 * メモリ上のセル数を設定する。
 */
export function setCellCount(notebookPath: string, count: number): void {
  // Map サイズが上限を超えた場合、最も古いエントリを削除
  if (!cellCounts.has(notebookPath) && cellCounts.size >= MAX_ENTRIES) {
    const oldestKey = cellCounts.keys().next().value;
    if (oldestKey !== undefined) {
      cellCounts.delete(oldestKey);
    }
  }
  cellCounts.set(notebookPath, count);
}

/**
 * ペンディングセルを登録する。
 * notebook_add_cell でセルを追加した後に呼び出し、
 * resolveOrCreateCell がディスク検索前にマッチできるようにする。
 */
export function addPendingCell(notebookPath: string, code: string, cellIndex: number): void {
  // 外側 Map のサイズ上限チェック
  if (!pendingCells.has(notebookPath) && pendingCells.size >= MAX_ENTRIES) {
    const oldestKey = pendingCells.keys().next().value;
    if (oldestKey !== undefined) {
      pendingCells.delete(oldestKey);
    }
  }

  if (!pendingCells.has(notebookPath)) {
    pendingCells.set(notebookPath, new Map());
  }

  const notebookPending = pendingCells.get(notebookPath)!;

  // 内側 Map のサイズ上限チェック
  if (notebookPending.size >= MAX_PENDING_PER_NOTEBOOK) {
    const oldestKey = notebookPending.keys().next().value;
    if (oldestKey !== undefined) {
      notebookPending.delete(oldestKey);
    }
  }

  notebookPending.set(code.trim(), cellIndex);
}

/**
 * ペンディングセルをコードで検索する。
 * 一致するセルが見つかった場合、そのインデックスを返す。
 */
export function findPendingCellIndex(notebookPath: string, code: string): number | undefined {
  return pendingCells.get(notebookPath)?.get(code.trim());
}

/**
 * ペンディングセルを消費（削除）する。
 * resolveOrCreateCell でマッチした後に呼び出し、使い終わったエントリを削除する。
 */
export function consumePendingCell(notebookPath: string, code: string): void {
  const notebookPending = pendingCells.get(notebookPath);
  if (!notebookPending) return;

  notebookPending.delete(code.trim());

  // 空になったらノートブックエントリも削除
  if (notebookPending.size === 0) {
    pendingCells.delete(notebookPath);
  }
}

/**
 * 追跡データをリセットする（テスト用）。
 */
export function resetCellTracker(): void {
  cellCounts.clear();
  pendingCells.clear();
}
