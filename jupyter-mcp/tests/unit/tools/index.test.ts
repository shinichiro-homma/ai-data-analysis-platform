import { describe, test, expect, vi, beforeEach } from 'vitest';
import { registerTools, handleToolCall } from '../../../src/tools/index.js';

// ヘルパー: モックレスポンスを生成する関数
const mockResponse = (toolName: string) => ({ content: [{ type: 'text', text: toolName }] });

// emitAiEditStart / emitAiEditEnd のモック
const mockEmitAiEditStart = vi.fn(async () => {});
const mockEmitAiEditEnd = vi.fn(async () => {});
vi.mock('../../../src/utils/ai-edit-helpers.js', () => ({
  validateAndResolveNotebookPath: vi.fn(),
  emitAiEditStart: (...args: unknown[]) => mockEmitAiEditStart(...args),
  emitAiEditEnd: (...args: unknown[]) => mockEmitAiEditEnd(...args),
}));

// 各ツール実装をモック
vi.mock('../../../src/tools/workspace-create.js', () => ({
  executeWorkspaceCreate: vi.fn(async () => mockResponse('workspace_create')),
}));
vi.mock('../../../src/tools/workspace-list.js', () => ({
  executeWorkspaceList: vi.fn(async () => mockResponse('workspace_list')),
}));
vi.mock('../../../src/tools/workspace-update.js', () => ({
  executeWorkspaceUpdate: vi.fn(async () => mockResponse('workspace_update')),
}));
vi.mock('../../../src/tools/workspace-summarize.js', () => ({
  executeWorkspaceSummarize: vi.fn(async () => mockResponse('workspace_summarize')),
}));
vi.mock('../../../src/tools/notebook-create.js', () => ({
  executeNotebookCreate: vi.fn(async () => mockResponse('notebook_create')),
}));
vi.mock('../../../src/tools/notebook-add-cell.js', () => ({
  executeNotebookAddCell: vi.fn(async () => mockResponse('notebook_add_cell')),
}));
vi.mock('../../../src/tools/session-create.js', () => ({
  executeSessionCreate: vi.fn(async () => mockResponse('session_create')),
}));
vi.mock('../../../src/tools/session-list.js', () => ({
  executeSessionList: vi.fn(async () => mockResponse('session_list')),
}));
vi.mock('../../../src/tools/session-delete.js', () => ({
  executeSessionDelete: vi.fn(async () => mockResponse('session_delete')),
}));
vi.mock('../../../src/tools/session-connect.js', () => ({
  executeSessionConnect: vi.fn(async () => mockResponse('session_connect')),
}));
vi.mock('../../../src/tools/execute-code.js', () => ({
  executeExecuteCode: vi.fn(async () => mockResponse('execute_code')),
}));
vi.mock('../../../src/tools/get-variables.js', () => ({
  executeGetVariables: vi.fn(async () => mockResponse('get_variables')),
}));
vi.mock('../../../src/tools/get-dataframe-info.js', () => ({
  executeGetDataframeInfo: vi.fn(async () => mockResponse('get_dataframe_info')),
}));
vi.mock('../../../src/tools/file-list.js', () => ({
  executeFileList: vi.fn(async () => mockResponse('file_list')),
}));
vi.mock('../../../src/tools/execute-sql.js', () => ({
  executeExecuteSql: vi.fn(async () => mockResponse('execute_sql')),
}));
vi.mock('../../../src/tools/export-sql.js', () => ({
  executeExportSql: vi.fn(async () => mockResponse('export_sql')),
}));
vi.mock('../../../src/tools/get-image.js', () => ({
  executeGetImage: vi.fn(async () => mockResponse('get_image')),
}));
vi.mock('../../../src/tools/notebook-list-cells.js', () => ({
  executeNotebookListCells: vi.fn(async () => mockResponse('notebook_list_cells')),
}));
vi.mock('../../../src/tools/notebook-edit-cell.js', () => ({
  executeNotebookEditCell: vi.fn(async () => mockResponse('notebook_edit_cell')),
}));
vi.mock('../../../src/tools/notebook-delete-cell.js', () => ({
  executeNotebookDeleteCell: vi.fn(async () => mockResponse('notebook_delete_cell')),
}));
vi.mock('../../../src/tools/notebook-execute-cell.js', () => ({
  executeNotebookExecuteCell: vi.fn(async () => mockResponse('notebook_execute_cell')),
}));
vi.mock('../../../src/tools/notebook-execute-batch.js', () => ({
  executeNotebookExecuteBatch: vi.fn(async () => mockResponse('notebook_execute_batch')),
}));
vi.mock('../../../src/tools/notebook-reorder-cell.js', () => ({
  executeNotebookReorderCell: vi.fn(async () => mockResponse('notebook_reorder_cell')),
}));
vi.mock('../../../src/tools/data-preview.js', () => ({
  executeDataPreview: vi.fn(async () => mockResponse('data_preview')),
}));
vi.mock('../../../src/tools/file-read.js', () => ({
  executeFileRead: vi.fn(async () => mockResponse('file_read')),
}));
vi.mock('../../../src/tools/notebook-merge-cells.js', () => ({
  executeNotebookMergeCells: vi.fn(async () => mockResponse('notebook_merge_cells')),
}));
vi.mock('../../../src/tools/notebook-split-cell.js', () => ({
  executeNotebookSplitCell: vi.fn(async () => mockResponse('notebook_split_cell')),
}));

beforeEach(() => {
  mockEmitAiEditStart.mockClear();
  mockEmitAiEditEnd.mockClear();
});

describe('registerTools', () => {
  test('全ツールが登録されている', () => {
    const tools = registerTools();
    expect(tools).toHaveLength(27);

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
  const NOTEBOOK_EDIT_TOOLS = [
    'execute_code',
    'notebook_add_cell',
    'notebook_edit_cell',
    'notebook_delete_cell',
    'notebook_execute_cell',
    'notebook_execute_batch',
    'notebook_reorder_cell',
  ];

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
