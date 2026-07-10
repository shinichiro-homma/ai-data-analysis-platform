/**
 * セル操作の共通ユーティリティ
 *
 * notebook_add_cell と execute_code の両方で使用される
 * セル追加ロジック（AI同期イベント + REST APIディスク書き込み + セルトラッカー更新）を共通化。
 *
 * 22.1: operateCellWithSync — 編集系ツール7本の共通パターン（operateCell → postAiEvent → 成功レスポンス）を集約。
 */

import { jupyterClient } from '../jupyter-client/client.js';
import type { CellOperationRequest, AiEvent } from '../jupyter-client/types.js';
import { setCellCount, addPendingCell } from './notebook-cell-tracker.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
} from './response-formatter.js';

/**
 * ノートブックにセルを追加する（AI同期イベント + REST APIディスク書き込み）。
 *
 * 1. AI同期イベントを配信（ブラウザが接続中なら SharedModel 経由でUI反映）
 * 2. 常に REST API でディスクに書き込む（永続化保証）
 * 3. メモリ上のセルカウント・ペンディングセルを更新
 *
 * @param notebookPath - ノートブックのパス
 * @param cellType - セルの種類
 * @param source - セルの内容
 * @param cellIndex - 挿入先セルインデックス
 * @param currentCellCount - 現在の有効セル数
 * @param position - 挿入位置（undefined の場合は末尾）
 */
export async function addCellWithSync(
  notebookPath: string,
  cellType: 'code' | 'markdown',
  source: string,
  cellIndex: number,
  currentCellCount: number,
  position?: number,
): Promise<void> {
  // AI同期イベントを配信（SharedModel経由でセルを追加）
  const eventResult = await jupyterClient.postAiEvent({
    type: 'cell_added',
    notebook_path: notebookPath,
    cell: {
      cell_type: cellType,
      source: source,
    },
    index: position ?? -1, // undefined の場合は -1（末尾追加を示す）
  });

  // 常に REST API でディスクに書き込む（永続化保証）
  await jupyterClient.operateCell(notebookPath, {
    action: 'add',
    cell: {
      cell_type: cellType,
      source: source,
    },
    index: position,
  });

  // メモリ上のセル数を更新
  setCellCount(notebookPath, currentCellCount + 1);

  // ペンディングセルを登録（resolveOrCreateCell でのディスク検索失敗時に重複を防ぐ）
  addPendingCell(notebookPath, source, cellIndex);
}

/**
 * セル操作（operateCell）→ AI同期イベント配信（postAiEvent）→ 成功レスポンス返却の共通パターン。
 *
 * 編集系ツール（edit / delete / reorder / merge / split / change_type / copy）で
 * 同一の try-catch パターンを繰り返していたものを集約する。
 */
export async function operateCellWithSync(
  notebookPath: string,
  operation: CellOperationRequest,
  event: AiEvent,
  successPayload: Record<string, unknown>,
): Promise<McpResponse> {
  try {
    await jupyterClient.operateCell(notebookPath, operation);
    await jupyterClient.postAiEvent(event);
    return createSuccessResponse(successPayload);
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}
