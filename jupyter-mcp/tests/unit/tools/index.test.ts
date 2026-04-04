import { describe, test, expect, vi } from 'vitest';
import { registerTools, handleToolCall } from '../../../src/tools/index.js';

// ヘルパー: モックレスポンスを生成する関数
const mockResponse = (toolName: string) => ({ content: [{ type: 'text', text: toolName }] });

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
vi.mock('../../../src/tools/ai-edit-start.js', () => ({
  executeAiEditStart: vi.fn(async () => mockResponse('ai_edit_start')),
}));
vi.mock('../../../src/tools/ai-edit-end.js', () => ({
  executeAiEditEnd: vi.fn(async () => mockResponse('ai_edit_end')),
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
describe('registerTools', () => {
  test('全ツールが登録されている', () => {
    const tools = registerTools();
    expect(tools).toHaveLength(23);

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
      'notebook_execute_cell',
      'session_create',
      'session_list',
      'session_delete',
      'session_connect',
      'execute_code',
      'get_variables',
      'get_dataframe_info',
      'file_list',
      'ai_edit_start',
      'ai_edit_end',
      'execute_sql',
      'export_sql',
      'get_image',
    ];

    const toolNames = tools.map((t) => t.name);
    expectedToolNames.forEach((name) => {
      expect(toolNames).toContain(name);
    });
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
    {
      toolName: 'notebook_execute_cell',
      args: { notebook_path: 'test.ipynb', session_id: 'session-1', cell_index: 0 },
    },
    { toolName: 'session_create', args: {} },
    { toolName: 'session_list', args: {} },
    { toolName: 'session_delete', args: { session_id: 'session-1' } },
    { toolName: 'session_connect', args: { notebook_path: 'test.ipynb' } },
    { toolName: 'execute_code', args: { session_id: 'session-1', code: 'print("test")' } },
    { toolName: 'get_variables', args: { session_id: 'session-1' } },
    { toolName: 'get_dataframe_info', args: { session_id: 'session-1', variable_name: 'df' } },
    { toolName: 'file_list', args: { session_id: 'session-1' } },
    { toolName: 'ai_edit_start', args: { session_id: 'session-1' } },
    { toolName: 'ai_edit_end', args: { session_id: 'session-1' } },
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
