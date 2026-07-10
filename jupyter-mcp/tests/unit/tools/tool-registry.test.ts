import { describe, test, expect } from 'vitest';
import type { ToolEntry } from '@ai-data-analysis/mcp-shared';
import type { McpToolResult } from '../../../src/utils/response-formatter.js';
import { MUTATING_TOOL_NAMES } from './fixtures.js';

// 各ツールの toolEntry を直接インポートする（モック不要）。
// mutatesNotebook は各ツールファイル側で宣言される（タスク 21.1）。
import { toolEntry as workspaceCreateEntry } from '../../../src/tools/workspace-create.js';
import { toolEntry as workspaceUpdateEntry } from '../../../src/tools/workspace-update.js';
import { toolEntry as workspaceListEntry } from '../../../src/tools/workspace-list.js';
import { toolEntry as workspaceSummarizeEntry } from '../../../src/tools/workspace-summarize.js';
import { toolEntry as notebookCreateEntry } from '../../../src/tools/notebook-create.js';
import { toolEntry as notebookAddCellEntry } from '../../../src/tools/notebook-add-cell.js';
import { toolEntry as notebookListCellsEntry } from '../../../src/tools/notebook-list-cells.js';
import { toolEntry as notebookEditCellEntry } from '../../../src/tools/notebook-edit-cell.js';
import { toolEntry as notebookDeleteCellEntry } from '../../../src/tools/notebook-delete-cell.js';
import { toolEntry as notebookReorderCellEntry } from '../../../src/tools/notebook-reorder-cell.js';
import { toolEntry as notebookExecuteCellEntry } from '../../../src/tools/notebook-execute-cell.js';
import { toolEntry as notebookExecuteBatchEntry } from '../../../src/tools/notebook-execute-batch.js';
import { toolEntry as notebookMergeCellsEntry } from '../../../src/tools/notebook-merge-cells.js';
import { toolEntry as notebookSplitCellEntry } from '../../../src/tools/notebook-split-cell.js';
import { toolEntry as notebookChangeCellTypeEntry } from '../../../src/tools/notebook-change-cell-type.js';
import { toolEntry as notebookCopyCellEntry } from '../../../src/tools/notebook-copy-cell.js';
import { toolEntry as notebookClearOutputsEntry } from '../../../src/tools/notebook-clear-outputs.js';
import { toolEntry as sessionCreateEntry } from '../../../src/tools/session-create.js';
import { toolEntry as sessionListEntry } from '../../../src/tools/session-list.js';
import { toolEntry as sessionDeleteEntry } from '../../../src/tools/session-delete.js';
import { toolEntry as sessionConnectEntry } from '../../../src/tools/session-connect.js';
import { toolEntry as executeCodeEntry } from '../../../src/tools/execute-code.js';
import { toolEntry as getVariablesEntry } from '../../../src/tools/get-variables.js';
import { toolEntry as getDataframeInfoEntry } from '../../../src/tools/get-dataframe-info.js';
import { toolEntry as fileListEntry } from '../../../src/tools/file-list.js';
import { toolEntry as executeSqlEntry } from '../../../src/tools/execute-sql.js';
import { toolEntry as exportSqlEntry } from '../../../src/tools/export-sql.js';
import { toolEntry as getImageEntry } from '../../../src/tools/get-image.js';
import { toolEntry as dataPreviewEntry } from '../../../src/tools/data-preview.js';
import { toolEntry as fileReadEntry } from '../../../src/tools/file-read.js';
import { toolEntry as kernelRestartEntry } from '../../../src/tools/kernel-restart.js';

/**
 * mutatesNotebook を持つツールエントリの構造的部分型。
 *
 * 実装完成後、各 toolEntry の型は JupyterToolEntry（mutatesNotebook: boolean 必須）
 * になるため、この型注釈は自然に成立する。実装前は mutatesNotebook が未定義のため
 * 走査アサーションが Red になる。
 */
type MutatingToolEntry = ToolEntry<McpToolResult> & { mutatesNotebook: boolean };

// index.ts の toolRegistry と同順の配列（テスト側で組み立てる）。
const toolRegistry: MutatingToolEntry[] = [
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
] as MutatingToolEntry[];

// index.ts はこのリストを toolRegistry の mutatesNotebook 宣言から導出する。
// 本テストは分類ミス検知のため期待値を独立に保持する（fixtures.ts 参照）。
const EXPECTED_MUTATING_TOOLS = [...MUTATING_TOOL_NAMES].sort();

// レジストリの全 31 ツール名（index.ts の toolRegistry と対応）。
const EXPECTED_ALL_TOOLS = [
  'workspace_create',
  'workspace_update',
  'workspace_list',
  'workspace_summarize',
  'notebook_create',
  'notebook_add_cell',
  'notebook_list_cells',
  'notebook_edit_cell',
  'notebook_delete_cell',
  'notebook_reorder_cell',
  'notebook_execute_cell',
  'notebook_execute_batch',
  'notebook_merge_cells',
  'notebook_split_cell',
  'notebook_change_cell_type',
  'notebook_copy_cell',
  'notebook_clear_outputs',
  'session_create',
  'session_list',
  'session_delete',
  'session_connect',
  'execute_code',
  'get_variables',
  'get_dataframe_info',
  'file_list',
  'execute_sql',
  'export_sql',
  'get_image',
  'data_preview',
  'file_read',
  'kernel_restart',
].sort();

describe('toolRegistry の mutatesNotebook 宣言', () => {
  test('mutatesNotebook: true のツール名集合が既知の 12 ツールと完全一致する', () => {
    const mutatingNames = toolRegistry
      .filter((entry) => entry.mutatesNotebook === true)
      .map((entry) => entry.definition.name)
      .sort();

    expect(mutatingNames).toEqual(EXPECTED_MUTATING_TOOLS);
  });

  test('全 31 ツールが mutatesNotebook を boolean で宣言している', () => {
    for (const entry of toolRegistry) {
      expect(
        typeof entry.mutatesNotebook,
        `${entry.definition.name} の mutatesNotebook が boolean で宣言されていない`,
      ).toBe('boolean');
    }
  });

  test('kernel_restart は mutatesNotebook: false（セル内容を変更しない）', () => {
    const kernelRestart = toolRegistry.find((entry) => entry.definition.name === 'kernel_restart');
    expect(kernelRestart?.mutatesNotebook).toBe(false);
  });
});

describe('レジストリとツール名の 1 対 1 対応', () => {
  test('レジストリの全ツール名が期待集合と完全一致する（重複・過不足なし）', () => {
    const registryNames = toolRegistry.map((entry) => entry.definition.name).sort();

    // 重複がないこと
    expect(new Set(registryNames).size).toBe(registryNames.length);
    // 期待集合と完全一致
    expect(registryNames).toEqual(EXPECTED_ALL_TOOLS);
  });
});
