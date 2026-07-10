import { describe, test, expect, vi, beforeEach } from 'vitest';
import { registerTools, handleToolCall } from '../../../src/tools/index.js';
import { MUTATING_TOOL_NAMES as NOTEBOOK_EDIT_TOOLS } from './fixtures.js';

// vi.hoisted: vi.mock より先に評価されるヘルパーを定義
// vi.hoisted は通常のトップレベル import した変数を参照できないため、
// フィクスチャの読み込みは async import で行う。
const { mockToolModule, mockEmitAiEditStart, mockEmitAiEditEnd } = await vi.hoisted(async () => {
  const mockResponse = (toolName: string) => ({ content: [{ type: 'text', text: toolName }] });

  // ノートブックを変更するツール（mutatesNotebook: true）。index.ts はこの宣言から
  // NOTEBOOK_EDIT_TOOLS を導出するため、モックにも同じ分類を持たせる（タスク 21.1）。
  // 期待値は tests/unit/tools/fixtures.ts で一元管理（tool-registry.test.ts と共有）。
  const { MUTATING_TOOL_NAMES } = await import('./fixtures.js');
  const MUTATING_TOOLS = new Set(MUTATING_TOOL_NAMES);

  const mockToolModule = (toolName: string, executeFnName: string) => {
    const executeFn = vi.fn(async () => mockResponse(toolName));
    return {
      [executeFnName]: executeFn,
      toolEntry: {
        mutatesNotebook: MUTATING_TOOLS.has(toolName),
        definition: {
          name: toolName,
          description: `Mock ${toolName}`,
          inputSchema: { type: 'object', properties: {}, required: [] },
        },
        execute: executeFn,
      },
    };
  };

  return {
    mockToolModule,
    mockEmitAiEditStart: vi.fn(async () => {}),
    mockEmitAiEditEnd: vi.fn(async () => {}),
  };
});
vi.mock('../../../src/utils/ai-edit-helpers.js', () => ({
  validateAndResolveNotebookPath: vi.fn(),
  emitAiEditStart: (...args: unknown[]) => mockEmitAiEditStart(...args),
  emitAiEditEnd: (...args: unknown[]) => mockEmitAiEditEnd(...args),
}));

// 各ツール実装をモック
vi.mock('../../../src/tools/workspace-create.js', () => mockToolModule('workspace_create', 'executeWorkspaceCreate'));
vi.mock('../../../src/tools/workspace-list.js', () => mockToolModule('workspace_list', 'executeWorkspaceList'));
vi.mock('../../../src/tools/workspace-update.js', () => mockToolModule('workspace_update', 'executeWorkspaceUpdate'));
vi.mock('../../../src/tools/workspace-summarize.js', () =>
  mockToolModule('workspace_summarize', 'executeWorkspaceSummarize'),
);
vi.mock('../../../src/tools/notebook-create.js', () => mockToolModule('notebook_create', 'executeNotebookCreate'));
vi.mock('../../../src/tools/notebook-add-cell.js', () => mockToolModule('notebook_add_cell', 'executeNotebookAddCell'));
vi.mock('../../../src/tools/session-create.js', () => mockToolModule('session_create', 'executeSessionCreate'));
vi.mock('../../../src/tools/session-list.js', () => mockToolModule('session_list', 'executeSessionList'));
vi.mock('../../../src/tools/session-delete.js', () => mockToolModule('session_delete', 'executeSessionDelete'));
vi.mock('../../../src/tools/session-connect.js', () => mockToolModule('session_connect', 'executeSessionConnect'));
vi.mock('../../../src/tools/execute-code.js', () => mockToolModule('execute_code', 'executeExecuteCode'));
vi.mock('../../../src/tools/get-variables.js', () => mockToolModule('get_variables', 'executeGetVariables'));
vi.mock('../../../src/tools/get-dataframe-info.js', () =>
  mockToolModule('get_dataframe_info', 'executeGetDataframeInfo'),
);
vi.mock('../../../src/tools/file-list.js', () => mockToolModule('file_list', 'executeFileList'));
vi.mock('../../../src/tools/execute-sql.js', () => mockToolModule('execute_sql', 'executeExecuteSql'));
vi.mock('../../../src/tools/export-sql.js', () => mockToolModule('export_sql', 'executeExportSql'));
vi.mock('../../../src/tools/get-image.js', () => mockToolModule('get_image', 'executeGetImage'));
vi.mock('../../../src/tools/notebook-list-cells.js', () =>
  mockToolModule('notebook_list_cells', 'executeNotebookListCells'),
);
vi.mock('../../../src/tools/notebook-edit-cell.js', () =>
  mockToolModule('notebook_edit_cell', 'executeNotebookEditCell'),
);
vi.mock('../../../src/tools/notebook-delete-cell.js', () =>
  mockToolModule('notebook_delete_cell', 'executeNotebookDeleteCell'),
);
vi.mock('../../../src/tools/notebook-execute-cell.js', () =>
  mockToolModule('notebook_execute_cell', 'executeNotebookExecuteCell'),
);
vi.mock('../../../src/tools/notebook-execute-batch.js', () =>
  mockToolModule('notebook_execute_batch', 'executeNotebookExecuteBatch'),
);
vi.mock('../../../src/tools/notebook-reorder-cell.js', () =>
  mockToolModule('notebook_reorder_cell', 'executeNotebookReorderCell'),
);
vi.mock('../../../src/tools/data-preview.js', () => mockToolModule('data_preview', 'executeDataPreview'));
vi.mock('../../../src/tools/file-read.js', () => mockToolModule('file_read', 'executeFileRead'));
vi.mock('../../../src/tools/notebook-merge-cells.js', () =>
  mockToolModule('notebook_merge_cells', 'executeNotebookMergeCells'),
);
vi.mock('../../../src/tools/notebook-split-cell.js', () =>
  mockToolModule('notebook_split_cell', 'executeNotebookSplitCell'),
);
vi.mock('../../../src/tools/notebook-change-cell-type.js', () =>
  mockToolModule('notebook_change_cell_type', 'executeNotebookChangeCellType'),
);
vi.mock('../../../src/tools/notebook-copy-cell.js', () =>
  mockToolModule('notebook_copy_cell', 'executeNotebookCopyCell'),
);
vi.mock('../../../src/tools/notebook-clear-outputs.js', () =>
  mockToolModule('notebook_clear_outputs', 'executeNotebookClearOutputs'),
);
vi.mock('../../../src/tools/kernel-restart.js', () => mockToolModule('kernel_restart', 'executeKernelRestart'));

beforeEach(() => {
  mockEmitAiEditStart.mockClear();
  mockEmitAiEditEnd.mockClear();
});

describe('registerTools', () => {
  test('全ツールが登録されている', () => {
    const tools = registerTools();
    expect(tools).toHaveLength(31);

    const expectedToolNames = [
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
      'notebook_merge_cells',
      'notebook_split_cell',
      'notebook_change_cell_type',
      'notebook_copy_cell',
      'notebook_clear_outputs',
      'kernel_restart',
    ];

    const toolNames = tools.map((t) => t.name);
    expectedToolNames.forEach((name) => {
      expect(toolNames).toContain(name);
    });
  });

  test('ai_edit_start, ai_edit_end がツール一覧に含まれない', () => {
    const tools = registerTools();
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).not.toContain('ai_edit_start');
    expect(toolNames).not.toContain('ai_edit_end');
  });

  test('各ツールにdescriptionがある', () => {
    const tools = registerTools();

    tools.forEach((tool) => {
      expect(tool.description).toBeDefined();
      expect(tool.description.length).toBeGreaterThan(0);
    });
  });

  test('各ツールにinputSchemaがある', () => {
    const tools = registerTools();

    tools.forEach((tool) => {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeDefined();
    });
  });
});

describe('handleToolCall', () => {
  // データドリブンテスト: 各ツールのルーティング確認
  const toolRoutingTestCases = [
    { toolName: 'workspace_create', args: { name: '売上分析' } },
    { toolName: 'workspace_list', args: {} },
    { toolName: 'workspace_update', args: { workspace_id: 'ws-123', summary: 'test' } },
    { toolName: 'workspace_summarize', args: { workspace_id: 'ws-123' } },
    { toolName: 'notebook_create', args: { name: 'test' } },
    {
      toolName: 'notebook_add_cell',
      args: { notebook_path: 'test.ipynb', cell_type: 'code', source: 'print("hello")' },
    },
    { toolName: 'notebook_list_cells', args: { notebook_path: 'test.ipynb' } },
    { toolName: 'notebook_edit_cell', args: { notebook_path: 'test.ipynb', cell_index: 0, source: 'print("hi")' } },
    { toolName: 'notebook_delete_cell', args: { notebook_path: 'test.ipynb', cell_index: 0 } },
    { toolName: 'notebook_reorder_cell', args: { notebook_path: 'test.ipynb', cell_index: 0, to_index: 1 } },
    {
      toolName: 'notebook_execute_cell',
      args: { notebook_path: 'test.ipynb', session_id: 'session-1', cell_index: 0 },
    },
    {
      toolName: 'notebook_execute_batch',
      args: { notebook_path: 'test.ipynb', session_id: 'session-1', mode: 'all' },
    },
    { toolName: 'session_create', args: {} },
    { toolName: 'session_list', args: {} },
    { toolName: 'session_delete', args: { session_id: 'session-1' } },
    { toolName: 'session_connect', args: { notebook_path: 'test.ipynb' } },
    { toolName: 'execute_code', args: { session_id: 'session-1', code: 'print("test")' } },
    { toolName: 'get_variables', args: { session_id: 'session-1' } },
    { toolName: 'get_dataframe_info', args: { session_id: 'session-1', variable_name: 'df' } },
    { toolName: 'file_list', args: { session_id: 'session-1' } },
    { toolName: 'execute_sql', args: { session_id: 'session-1', sql: 'SELECT 1', filename: 'test.csv' } },
    { toolName: 'export_sql', args: { session_id: 'session-1', sql: 'SELECT 1', filename: 'export.parquet' } },
    { toolName: 'get_image', args: { file_path: 'workspaces/ws-123/output/exec-1-img-001.png' } },
    { toolName: 'data_preview', args: { workspace_id: 'ws-123', file_path: 'test.csv' } },
    { toolName: 'file_read', args: { workspace_id: 'ws-123', file_path: 'test.csv' } },
    { toolName: 'notebook_merge_cells', args: { notebook_path: 'test.ipynb', start_index: 0, end_index: 1 } },
    { toolName: 'notebook_split_cell', args: { notebook_path: 'test.ipynb', cell_index: 0, split_line: 1 } },
    {
      toolName: 'notebook_change_cell_type',
      args: { notebook_path: 'test.ipynb', cell_index: 0, new_type: 'markdown' },
    },
    { toolName: 'notebook_copy_cell', args: { notebook_path: 'test.ipynb', cell_index: 0 } },
    { toolName: 'notebook_clear_outputs', args: { notebook_path: 'test.ipynb' } },
    { toolName: 'kernel_restart', args: { session_id: 'session-1' } },
  ];

  toolRoutingTestCases.forEach(({ toolName, args }) => {
    test(`${toolName} => 正しくルーティング`, async () => {
      const result = await handleToolCall(toolName, args);
      expect(result.content[0].text).toBe(toolName);
    });
  });

  test('存在しないツール名 => エラーレスポンス', async () => {
    const result = await handleToolCall('unknown_tool', {});
    const parsed = JSON.parse(result.content[0].text!);
    expect(parsed.success).toBe(false);
    expect(parsed.error.code).toBe('UNKNOWN_TOOL');
    expect(parsed.error.message).toContain('Unknown tool: unknown_tool');
  });
});

describe('handleToolCall ミドルウェア（自動AI編集モード）', () => {
  NOTEBOOK_EDIT_TOOLS.forEach((toolName) => {
    test(`${toolName} 実行時に emitAiEditStart が呼ばれる`, async () => {
      const args = {
        session_id: 'session-1',
        notebook_path: 'test.ipynb',
        cell_type: 'code',
        source: 'x=1',
        cell_index: 0,
        to_index: 1,
        code: 'x=1',
      };
      await handleToolCall(toolName, args);
      expect(mockEmitAiEditStart).toHaveBeenCalledTimes(1);
      expect(mockEmitAiEditStart).toHaveBeenCalledWith(args);
    });
  });

  NOTEBOOK_EDIT_TOOLS.forEach((toolName) => {
    test(`${toolName} 実行完了後に emitAiEditEnd が呼ばれる`, async () => {
      const args = {
        session_id: 'session-1',
        notebook_path: 'test.ipynb',
        cell_type: 'code',
        source: 'x=1',
        cell_index: 0,
        to_index: 1,
        code: 'x=1',
      };
      await handleToolCall(toolName, args);
      expect(mockEmitAiEditEnd).toHaveBeenCalledTimes(1);
      expect(mockEmitAiEditEnd).toHaveBeenCalledWith(args);
    });
  });

  test('NOTEBOOK_EDIT_TOOLS に含まれないツール（session_list）は emitAiEditStart/End が呼ばれない', async () => {
    await handleToolCall('session_list', {});
    expect(mockEmitAiEditStart).not.toHaveBeenCalled();
    expect(mockEmitAiEditEnd).not.toHaveBeenCalled();
  });

  test('ツール実行がエラーでも emitAiEditEnd が呼ばれる（try...finally）', async () => {
    // execute_code のモックをエラーに変更
    const { executeExecuteCode } = await import('../../../src/tools/execute-code.js');
    (executeExecuteCode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('execution failed'));

    // sharedHandleToolCall 内で catch されてエラーレスポンスが返る
    await handleToolCall('execute_code', { session_id: 'session-1', code: 'bad code' });

    expect(mockEmitAiEditStart).toHaveBeenCalledTimes(1);
    expect(mockEmitAiEditEnd).toHaveBeenCalledTimes(1);
  });
});
