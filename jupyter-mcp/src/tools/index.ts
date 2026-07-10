/**
 * MCP ツールの登録とルーティング
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  type ToolEntry,
  registerTools as sharedRegisterTools,
  handleToolCall as sharedHandleToolCall,
} from '@ai-data-analysis/mcp-shared';
import { type McpToolResult } from '../utils/response-formatter.js';
import { emitAiEditStart, emitAiEditEnd } from '../utils/ai-edit-helpers.js';

import { toolEntry as workspaceCreateEntry } from './workspace-create.js';
import { toolEntry as workspaceUpdateEntry } from './workspace-update.js';
import { toolEntry as workspaceListEntry } from './workspace-list.js';
import { toolEntry as workspaceSummarizeEntry } from './workspace-summarize.js';
import { toolEntry as notebookCreateEntry } from './notebook-create.js';
import { toolEntry as notebookAddCellEntry } from './notebook-add-cell.js';
import { toolEntry as notebookListCellsEntry } from './notebook-list-cells.js';
import { toolEntry as notebookEditCellEntry } from './notebook-edit-cell.js';
import { toolEntry as notebookDeleteCellEntry } from './notebook-delete-cell.js';
import { toolEntry as notebookReorderCellEntry } from './notebook-reorder-cell.js';
import { toolEntry as notebookExecuteCellEntry } from './notebook-execute-cell.js';
import { toolEntry as notebookExecuteBatchEntry } from './notebook-execute-batch.js';
import { toolEntry as notebookMergeCellsEntry } from './notebook-merge-cells.js';
import { toolEntry as notebookSplitCellEntry } from './notebook-split-cell.js';
import { toolEntry as notebookChangeCellTypeEntry } from './notebook-change-cell-type.js';
import { toolEntry as notebookCopyCellEntry } from './notebook-copy-cell.js';
import { toolEntry as notebookClearOutputsEntry } from './notebook-clear-outputs.js';
import { toolEntry as sessionCreateEntry } from './session-create.js';
import { toolEntry as sessionListEntry } from './session-list.js';
import { toolEntry as sessionDeleteEntry } from './session-delete.js';
import { toolEntry as sessionConnectEntry } from './session-connect.js';
import { toolEntry as executeCodeEntry } from './execute-code.js';
import { toolEntry as getVariablesEntry } from './get-variables.js';
import { toolEntry as getDataframeInfoEntry } from './get-dataframe-info.js';
import { toolEntry as fileListEntry } from './file-list.js';
import { toolEntry as executeSqlEntry } from './execute-sql.js';
import { toolEntry as exportSqlEntry } from './export-sql.js';
import { toolEntry as getImageEntry } from './get-image.js';
import { toolEntry as dataPreviewEntry } from './data-preview.js';
import { toolEntry as fileReadEntry } from './file-read.js';
import { toolEntry as kernelRestartEntry } from './kernel-restart.js';

const toolRegistry: ToolEntry<McpToolResult>[] = [
  workspaceCreateEntry,
  workspaceUpdateEntry,
  workspaceListEntry,
  workspaceSummarizeEntry,
  notebookCreateEntry,
  notebookAddCellEntry,
  notebookListCellsEntry,
  notebookEditCellEntry,
  notebookDeleteCellEntry,
  notebookReorderCellEntry,
  notebookExecuteCellEntry,
  notebookExecuteBatchEntry,
  notebookMergeCellsEntry,
  notebookSplitCellEntry,
  notebookChangeCellTypeEntry,
  notebookCopyCellEntry,
  notebookClearOutputsEntry,
  sessionCreateEntry,
  sessionListEntry,
  sessionDeleteEntry,
  sessionConnectEntry,
  executeCodeEntry,
  getVariablesEntry,
  getDataframeInfoEntry,
  fileListEntry,
  executeSqlEntry,
  exportSqlEntry,
  getImageEntry,
  dataPreviewEntry,
  fileReadEntry,
  kernelRestartEntry,
];

/** ノートブック編集系ツール: 実行前後に ai_edit_start/end イベントを自動配信する
 *  kernel_restart はセル内容を変更しないため対象外 */
const NOTEBOOK_EDIT_TOOLS = new Set([
  'execute_code',
  'notebook_add_cell',
  'notebook_edit_cell',
  'notebook_delete_cell',
  'notebook_execute_cell',
  'notebook_execute_batch',
  'notebook_reorder_cell',
  'notebook_merge_cells',
  'notebook_split_cell',
  'notebook_change_cell_type',
  'notebook_copy_cell',
  'notebook_clear_outputs',
]);

/**
 * ツール定義一覧を返す
 */
export function registerTools(): Tool[] {
  return sharedRegisterTools(toolRegistry);
}

/**
 * ツール名から実装関数へルーティング
 * NOTEBOOK_EDIT_TOOLS に含まれるツールは前後に ai_edit_start/end イベントを自動配信する
 */
export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
  const execute = () => sharedHandleToolCall(toolRegistry, name, args) as Promise<McpToolResult>;

  if (!NOTEBOOK_EDIT_TOOLS.has(name)) return execute();

  try {
    await emitAiEditStart(args);
    return await execute();
  } finally {
    await emitAiEditEnd(args);
  }
}
