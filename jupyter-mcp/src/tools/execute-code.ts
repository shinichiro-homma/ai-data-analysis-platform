/**
 * execute_code ツール実装
 */

import { jupyterClient } from '../jupyter-client/client.js';
import {
  createSuccessResponse,
  createErrorResponse,
  extractErrorCode,
  extractErrorMessage,
  type McpResponse,
  type McpToolResult,
} from '../utils/response-formatter.js';
import type { JupyterToolEntry } from './types.js';
import { validateStringParameter, validateNumberParameter } from '../utils/validation.js';
import { resolveSession } from '../utils/session-resolver.js';
import { toImageReference } from '../image-store/index.js';
import type { ImageOutput } from '../jupyter-client/types.js';
import { getContentsWithTimeout } from '../utils/notebook-helpers.js';
import { getEffectiveCellCount, findPendingCellIndex, consumePendingCell } from '../utils/notebook-cell-tracker.js';
import { addCellWithSync } from '../utils/cell-operations.js';
import type { ExecuteResult, BroadcastEventResponse, CellOutputData, AiEvent } from '../jupyter-client/types.js';
import { logger } from '../utils/logger.js';

interface ExecuteCodeArgs {
  session_id: string;
  code: string;
  timeout?: number;
  cell_index?: number;
}

/**
 * Python コードを実行する
 */
export async function executeExecuteCode(args: Record<string, unknown>): Promise<McpResponse> {
  const { session_id, code = '', timeout = 30, cell_index: requestedCellIndex } = args as Partial<ExecuteCodeArgs>;

  // 入力検証: session_id
  const sessionIdValidation = validateStringParameter(session_id, 'session_id', {
    required: true,
    maxLength: 200,
    allowEmpty: false,
  });

  if (!sessionIdValidation.isValid) {
    return createErrorResponse(sessionIdValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 検証後、session_id は必ず string
  const validatedSessionId = session_id as string;

  // 入力検証: code
  const codeValidation = validateStringParameter(code, 'code', {
    required: false,
    allowEmpty: true,
    maxLength: 1000000,
    allowNull: false,
  });

  if (!codeValidation.isValid) {
    return createErrorResponse(codeValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 入力検証: timeout
  const timeoutValidation = validateNumberParameter(timeout, 'timeout', {
    min: 0,
    max: 300,
  });
  if (!timeoutValidation.isValid) {
    return createErrorResponse(timeoutValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  // 入力検証: cell_index
  const cellIndexValidation = validateNumberParameter(requestedCellIndex, 'cell_index', {
    min: -1,
    max: 10000,
    integer: true,
  });
  if (!cellIndexValidation.isValid) {
    return createErrorResponse(cellIndexValidation.errorMessage!, 'VALIDATION_ERROR');
  }

  try {
    // session_id から kernel_id と notebook_path を一度に解決（listSessions 1回で済む）
    const { kernelId, notebookPath } = await resolveSession(validatedSessionId);

    // セルインデックスを特定
    let cellIndex = -1;
    if (notebookPath) {
      if (requestedCellIndex !== undefined && requestedCellIndex >= 0) {
        // cell_index が明示的に指定された場合はそのまま使用（resolveOrCreateCell をスキップ）
        cellIndex = requestedCellIndex;
      } else {
        // 未指定の場合は従来の resolveOrCreateCell にフォールバック
        cellIndex = await resolveOrCreateCell(notebookPath, code);
      }
    }

    const hasCellPosition = notebookPath && cellIndex >= 0;

    // cell_execute_start イベント配信（fire-and-forget: 失敗しても続行）
    if (hasCellPosition) {
      await postAiEventSafe(
        {
          type: 'cell_execute_start',
          notebook_path: notebookPath,
          cell_index: cellIndex,
        },
        'post cell_execute_start event',
      );
    }

    // コード実行
    const result = await jupyterClient.executeCode(kernelId, {
      code,
      timeout,
    });

    // cell_output イベント配信（実行完了後にまとめて配信）
    // lastBroadcastClientCount: 最後の cell_output イベントを受信したクライアント数
    let lastBroadcastClientCount = 0;
    const nbOutputs = hasCellPosition ? buildNotebookOutputs(result) : [];

    if (hasCellPosition) {
      try {
        const broadcastResult = await broadcastOutputEvents(notebookPath, cellIndex, nbOutputs);
        lastBroadcastClientCount = broadcastResult.clients;
      } catch (error) {
        logger.error('[execute_code] Failed to broadcast output events:', extractErrorMessage(error));
      }
    }

    // ブラウザが接続していない場合のみ、セル出力をディスクに永続化
    if (hasCellPosition && lastBroadcastClientCount === 0) {
      try {
        await jupyterClient.updateCellOutputs(notebookPath, cellIndex, nbOutputs, result.execution_count);
      } catch (error) {
        logger.error('[execute_code] Failed to persist cell outputs:', extractErrorMessage(error));
      }
    }

    // cell_execute_end イベント配信（fire-and-forget: 失敗しても続行）
    if (hasCellPosition) {
      await postAiEventSafe(
        {
          type: 'cell_execute_end',
          notebook_path: notebookPath,
          cell_index: cellIndex,
          execution_count: result.execution_count,
          success: result.success,
        },
        'post cell_execute_end event',
      );
    }

    // 成功時のレスポンス
    if (result.success) {
      // stdout と stderr を結合
      const stdout = result.outputs
        .filter((o) => o.type === 'stdout')
        .map((o) => o.text)
        .join('');
      const stderr = result.outputs
        .filter((o) => o.type === 'stderr')
        .map((o) => o.text)
        .join('');

      // 画像をImageReference形式に変換（ファイルはjupyter-server側で保存済み）
      // file_path が null の画像はスキップ（ワークスペース解決に失敗した場合）
      const imageReferences = result.images
        .filter((img): img is ImageOutput & { file_path: string } => img.file_path != null)
        .map((img) => toImageReference(img));

      return createSuccessResponse({
        stdout,
        stderr,
        result: result.result,
        images: imageReferences,
        execution_time_ms: result.execution_time_ms,
      });
    }

    // エラー時のレスポンス
    if (result.error) {
      return createErrorResponse(result.error.message, result.error.type || 'EXECUTION_ERROR');
    }

    // エラーだが error フィールドがない場合
    return createErrorResponse('コード実行に失敗しました', 'EXECUTION_ERROR');
  } catch (error) {
    return createErrorResponse(extractErrorMessage(error), extractErrorCode(error));
  }
}

/**
 * AIイベントを安全に配信する（fire-and-forget: 失敗しても続行）
 */
async function postAiEventSafe(event: AiEvent, context: string): Promise<BroadcastEventResponse | null> {
  try {
    return await jupyterClient.postAiEvent(event);
  } catch (error) {
    logger.error(`[execute_code] Failed to ${context}:`, extractErrorMessage(error));
    return null;
  }
}

/**
 * ノートブックの末尾セルのソースと実行コードを比較し、
 * 一致しない場合（またはセルが存在しない場合）にコードセルを自動追加する。
 *
 * - notebook_add_cell → execute_code の正常フロー: 末尾セルのソースが一致 → 既存セルを使用
 * - execute_code のみ呼ばれた場合: 末尾セルのソースが不一致 → セルを自動追加
 *
 * @returns セルのインデックス（追加失敗時は -1）
 */
async function resolveOrCreateCell(notebookPath: string, code: string): Promise<number> {
  try {
    // notebook_add_cell で追加済みだがディスク未反映のセルをチェック（重複防止）
    const pendingIndex = findPendingCellIndex(notebookPath, code);
    if (pendingIndex !== undefined) {
      consumePendingCell(notebookPath, code);
      return pendingIndex;
    }

    const notebook = await getContentsWithTimeout(notebookPath);

    const cells = notebook.content.cells;

    // 全セルを逆順検索してコード一致を探す
    for (let i = cells.length - 1; i >= 0; i--) {
      const cell = cells[i];
      if (cell.cell_type === 'code' && cell.source.trim() === code.trim()) {
        return i;
      }
    }

    // 一致しない場合（またはセルが0個の場合）→ セルを自動追加
    // ディスクとメモリの大きい方をセル数として使用（ディスク反映遅延対策）
    const effectiveCellCount = await getEffectiveCellCount(notebookPath);
    return await addCellToNotebook(notebookPath, code, effectiveCellCount);
  } catch (error) {
    logger.error('[resolveOrCreateCell] Failed:', extractErrorMessage(error));
    return -1;
  }
}

/**
 * ノートブックにコードセルを自動追加する
 *
 * @returns 追加されたセルのインデックス（失敗時は -1）
 */
async function addCellToNotebook(notebookPath: string, code: string, currentCellCount: number): Promise<number> {
  try {
    await addCellWithSync(notebookPath, 'code', code, currentCellCount, currentCellCount);
    return currentCellCount;
  } catch (error) {
    logger.error('[addCellToNotebook] Failed to add cell:', extractErrorMessage(error));
    return -1;
  }
}

/**
 * ExecuteResult から Jupyter Notebook の outputs 形式に変換する
 */
function buildNotebookOutputs(result: ExecuteResult): CellOutputData[] {
  const outputs: CellOutputData[] = [];

  // stdout/stderr
  for (const output of result.outputs) {
    outputs.push({
      output_type: 'stream',
      name: output.type,
      text: output.text,
    });
  }

  // 画像出力: 画像ファイルは jupyter-server 側で output/ に保存済み。
  // display_data イベントはカーネルの WebSocket ストリーミング経由で
  // JupyterLab に配信されるため、ここでは生成不要。

  // 式の評価結果
  if (result.result !== null && result.result !== undefined) {
    outputs.push({
      output_type: 'execute_result',
      execution_count: result.execution_count,
      data: { 'text/plain': String(result.result) },
      metadata: {},
    });
  }

  // エラー出力
  if (result.error) {
    outputs.push({
      output_type: 'error',
      ename: result.error.type,
      evalue: result.error.message,
      traceback: result.error.traceback,
    });
  }

  return outputs;
}

/**
 * 出力をセル出力イベントとして配信する
 */
async function broadcastOutputEvents(
  notebookPath: string,
  cellIndex: number,
  outputs: CellOutputData[],
): Promise<BroadcastEventResponse> {
  let lastResult: BroadcastEventResponse = { broadcasted: false, clients: 0 };

  for (const output of outputs) {
    lastResult = await jupyterClient.postAiEvent({
      type: 'cell_output',
      notebook_path: notebookPath,
      cell_index: cellIndex,
      output,
    });
  }

  return lastResult;
}

export const toolEntry: JupyterToolEntry = {
  mutatesNotebook: true,
  definition: {
    name: 'execute_code',
    description:
      "Executes Python code for data analysis, aggregation, and visualization. pandas, matplotlib, etc. are available. Returns execution results and chart images. Automatically adds a notebook cell if none exists. CSVs saved by execute_sql can be loaded via pd.read_csv('data/filename.csv'). Use get_image to view chart images. [Security] Shell commands (!command, subprocess, os.system, ctypes) are blocked by AST inspection + sandbox.",
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session ID' },
        code: {
          type: 'string',
          description: 'Python code to execute. Shell commands (!command, subprocess, os.system, ctypes) are blocked',
        },
        timeout: { type: 'number', description: 'Timeout in seconds (default: 30, max: 300)' },
        cell_index: {
          type: 'number',
          description:
            'Cell index to execute (use cell_index from notebook_add_cell return value. Auto-detected if omitted)',
        },
      },
      required: ['session_id'],
    },
  },
  execute: executeExecuteCode,
};
