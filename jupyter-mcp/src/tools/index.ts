import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  registerTools as sharedRegisterTools,
  handleToolCall as sharedHandleToolCall,
} from '@ai-data-analysis/mcp-shared';
import { type McpToolResult } from '../utils/response-formatter.js';
import { emitAiEditStart, emitAiEditEnd } from '../utils/ai-edit-helpers.js';
import type { JupyterToolEntry } from './types.js';
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
const toolRegistry: JupyterToolEntry[] = [
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
// ノートブックを変更するツール名の集合。各ツールが宣言する mutatesNotebook から導出する
// （手動 allowlist は廃止。宣言漏れは JupyterToolEntry の型チェックで検知される）。
const NOTEBOOK_EDIT_TOOLS = new Set(
  toolRegistry.filter((entry) => entry.mutatesNotebook).map((entry) => entry.definition.name),
);

export function registerTools(): Tool[] {
  return sharedRegisterTools(toolRegistry);
}
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
