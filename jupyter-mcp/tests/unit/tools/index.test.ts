import { describe, test, expect, vi } from 'vitest';
import { registerTools, handleToolCall } from '../../../src/tools/index.js';

// ヘルパー: モックレスポンスを生成する関数
const mockResponse = (toolName: string) => ({ content: [{ type: 'text', text: toolName }] });

// 各ツール実装をモック
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
vi.mock('../../../src/tools/get-image-resource.js', () => ({
  executeGetImageResource: vi.fn(async () => mockResponse('get_image_resource')),
}));

describe('registerTools', () => {
  test('全ツールが登録されている', () => {
    const tools = registerTools();
    expect(tools).toHaveLength(11);

    const expectedToolNames = [
      'notebook_create',
      'notebook_add_cell',
      'session_create',
      'session_list',
      'session_delete',
      'session_connect',
      'execute_code',
      'get_variables',
      'get_dataframe_info',
      'file_list',
      'get_image_resource',
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
    { toolName: 'notebook_create', args: { name: 'test' } },
    { toolName: 'notebook_add_cell', args: { notebook_path: 'test.ipynb', cell_type: 'code', source: 'print("hello")' } },
    { toolName: 'session_create', args: {} },
    { toolName: 'session_list', args: {} },
    { toolName: 'session_delete', args: { session_id: 'session-1' } },
    { toolName: 'session_connect', args: { notebook_path: 'test.ipynb' } },
    { toolName: 'execute_code', args: { session_id: 'session-1', code: 'print("test")' } },
    { toolName: 'get_variables', args: { session_id: 'session-1' } },
    { toolName: 'get_dataframe_info', args: { session_id: 'session-1', variable_name: 'df' } },
    { toolName: 'file_list', args: { session_id: 'session-1' } },
    { toolName: 'get_image_resource', args: { resource_uri: 'jupyter://sessions/session-1/images/img-1.png' } },
  ];

  toolRoutingTestCases.forEach(({ toolName, args }) => {
    test(`${toolName} => 正しくルーティング`, async () => {
      const result = await handleToolCall(toolName, args);
      expect(result.content[0].text).toBe(toolName);
    });
  });

  test('存在しないツール名 => エラー', async () => {
    await expect(handleToolCall('unknown_tool', {})).rejects.toThrow('Unknown tool: unknown_tool');
  });
});
