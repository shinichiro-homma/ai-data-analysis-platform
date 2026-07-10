/**
 * zod スキーマのバリデーションテスト
 *
 * 22.2: API レスポンス型の zod スキーマが正しくパース/拒否することを検証する。
 * - 正常系: 正しい形式のデータがパースできる
 * - 異常系: 不正なデータで ZodError が発生する
 * - 異常系: 必須フィールド欠落で ZodError が発生する
 */

import { describe, test, expect } from 'vitest';
import {
  KernelSchema,
  DeleteKernelResponseSchema,
  JupyterSessionSchema,
  ExecuteResultSchema,
  VariableSchema,
  ContentsListResponseSchema,
  NotebookResponseSchema,
  CreateContentResponseSchema,
  WorkspaceInfoSchema,
  WorkspaceSummarizeResponseSchema,
  WorkspaceSessionInfoSchema,
  HealthStatusSchema,
  BroadcastEventResponseSchema,
  SqlExecuteResponseSchema,
  SqlExportResponseSchema,
  CellExecuteResponseSchema,
  CellExecuteBatchResponseSchema,
  ClearAllOutputsResponseSchema,
  DataPreviewResponseSchema,
  TextFileResponseSchema,
} from '../../../src/jupyter-client/schemas.js';

describe('zod スキーマ: Kernel', () => {
  test('正常系: 正しいカーネルデータをパースできる', () => {
    const data = {
      id: 'kernel-123',
      name: 'python3',
      status: 'idle',
      started_at: '2026-01-01T00:00:00Z',
    };

    const result = KernelSchema.parse(data);
    expect(result.id).toBe('kernel-123');
    expect(result.status).toBe('idle');
  });

  test('正常系: execution_count はオプショナル', () => {
    const data = {
      id: 'kernel-123',
      name: 'python3',
      status: 'busy',
      started_at: '2026-01-01T00:00:00Z',
      execution_count: 42,
    };

    const result = KernelSchema.parse(data);
    expect(result.execution_count).toBe(42);
  });

  test('異常系: id が欠落すると ZodError', () => {
    const data = {
      name: 'python3',
      status: 'idle',
      started_at: '2026-01-01T00:00:00Z',
    };

    expect(() => KernelSchema.parse(data)).toThrow();
  });

  test('異常系: status が不正な値だと ZodError', () => {
    const data = {
      id: 'kernel-123',
      name: 'python3',
      status: 'invalid_status',
      started_at: '2026-01-01T00:00:00Z',
    };

    expect(() => KernelSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: DeleteKernelResponse', () => {
  test('正常系: 正しいデータをパースできる', () => {
    const data = { id: 'kernel-123', status: 'deleted' };
    const result = DeleteKernelResponseSchema.parse(data);
    expect(result.status).toBe('deleted');
  });
});

describe('zod スキーマ: JupyterSession', () => {
  test('正常系: 正しいセッションデータをパースできる', () => {
    const data = {
      id: 'session-123',
      path: 'analysis.ipynb',
      name: 'analysis.ipynb',
      type: 'notebook',
      kernel: {
        id: 'kernel-456',
        name: 'python3',
        last_activity: '2026-01-01T00:00:00Z',
        execution_state: 'idle',
        connections: 2,
      },
    };

    const result = JupyterSessionSchema.parse(data);
    expect(result.id).toBe('session-123');
    expect(result.kernel.id).toBe('kernel-456');
  });

  test('異常系: kernel オブジェクトが欠落すると ZodError', () => {
    const data = {
      id: 'session-123',
      path: 'analysis.ipynb',
      name: 'analysis.ipynb',
      type: 'notebook',
    };

    expect(() => JupyterSessionSchema.parse(data)).toThrow();
  });

  test('異常系: kernel.connections が数値でないと ZodError', () => {
    const data = {
      id: 'session-123',
      path: 'analysis.ipynb',
      name: 'analysis.ipynb',
      type: 'notebook',
      kernel: {
        id: 'kernel-456',
        name: 'python3',
        last_activity: '2026-01-01T00:00:00Z',
        execution_state: 'idle',
        connections: 'not-a-number',
      },
    };

    expect(() => JupyterSessionSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: ExecuteResult', () => {
  test('正常系: 正しい実行結果をパースできる', () => {
    const data = {
      success: true,
      execution_count: 1,
      outputs: [{ type: 'stdout', text: 'hello\n' }],
      result: null,
      images: [],
      execution_time_ms: 150,
    };

    const result = ExecuteResultSchema.parse(data);
    expect(result.success).toBe(true);
    expect(result.execution_count).toBe(1);
  });

  test('正常系: エラー付きの実行結果をパースできる', () => {
    const data = {
      success: false,
      execution_count: 2,
      outputs: [],
      result: null,
      images: [],
      execution_time_ms: 50,
      error: {
        type: 'NameError',
        message: "name 'x' is not defined",
        traceback: ['Traceback...', '  File...'],
      },
    };

    const result = ExecuteResultSchema.parse(data);
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('NameError');
  });

  test('正常系: 画像付きの実行結果をパースできる', () => {
    const data = {
      success: true,
      execution_count: 3,
      outputs: [],
      result: null,
      images: [
        {
          file_path: 'workspaces/ws-123/output/exec-3-img-001.png',
          mime_type: 'image/png',
          description: 'Generated plot',
        },
      ],
      execution_time_ms: 500,
    };

    const result = ExecuteResultSchema.parse(data);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].file_path).toContain('img-001.png');
  });

  test('正常系: file_path が null の画像をパースできる（ワークスペース解決失敗時）', () => {
    const data = {
      success: true,
      execution_count: 4,
      outputs: [],
      result: null,
      images: [
        {
          file_path: null,
          mime_type: 'image/png',
          description: 'Generated plot',
        },
      ],
      execution_time_ms: 300,
    };

    const result = ExecuteResultSchema.parse(data);
    expect(result.images).toHaveLength(1);
    expect(result.images[0].file_path).toBeNull();
  });

  test('異常系: success フィールドが欠落すると ZodError', () => {
    const data = {
      execution_count: 1,
      outputs: [],
      result: null,
      images: [],
      execution_time_ms: 100,
    };

    expect(() => ExecuteResultSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: Variable', () => {
  test('正常系: 基本的な変数データをパースできる', () => {
    const data = {
      name: 'df',
      type: 'DataFrame',
    };

    const result = VariableSchema.parse(data);
    expect(result.name).toBe('df');
    expect(result.type).toBe('DataFrame');
  });

  test('正常系: オプショナルフィールド付きでパースできる', () => {
    const data = {
      name: 'x',
      type: 'int',
      value: 42,
      size: '28 bytes',
      memory_bytes: 28,
    };

    const result = VariableSchema.parse(data);
    expect(result.value).toBe(42);
    expect(result.memory_bytes).toBe(28);
  });
});

describe('zod スキーマ: ContentsListResponse', () => {
  test('正常系: ファイル一覧をパースできる', () => {
    const data = {
      path: '/workspaces/ws-123',
      contents: [
        { name: 'analysis.ipynb', type: 'notebook', modified_at: '2026-01-01T00:00:00Z' },
        { name: 'data.csv', type: 'file', size: 1024, modified_at: '2026-01-01T00:00:00Z' },
      ],
    };

    const result = ContentsListResponseSchema.parse(data);
    expect(result.contents).toHaveLength(2);
  });

  test('異常系: contents が配列でないと ZodError', () => {
    const data = {
      path: '/workspaces/ws-123',
      contents: 'not-an-array',
    };

    expect(() => ContentsListResponseSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: NotebookResponse', () => {
  test('正常系: ノートブックレスポンスをパースできる', () => {
    const data = {
      path: 'analysis.ipynb',
      type: 'notebook',
      content: {
        cells: [
          {
            cell_type: 'code',
            source: 'import pandas as pd',
            outputs: [],
            execution_count: 1,
          },
          {
            cell_type: 'markdown',
            source: '# Analysis',
          },
        ],
        metadata: { kernel: 'python3' },
      },
      modified_at: '2026-01-01T00:00:00Z',
    };

    const result = NotebookResponseSchema.parse(data);
    expect(result.content.cells).toHaveLength(2);
    expect(result.content.cells[0].cell_type).toBe('code');
  });

  test('異常系: type が notebook でないと ZodError', () => {
    const data = {
      path: 'data.csv',
      type: 'file',
      content: { cells: [], metadata: {} },
      modified_at: '2026-01-01T00:00:00Z',
    };

    expect(() => NotebookResponseSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: BroadcastEventResponse', () => {
  test('正常系: ブロードキャスト成功をパースできる', () => {
    const data = { broadcasted: true, clients: 3 };
    const result = BroadcastEventResponseSchema.parse(data);
    expect(result.broadcasted).toBe(true);
    expect(result.clients).toBe(3);
  });

  test('正常系: クライアント0のフォールバックをパースできる', () => {
    const data = { broadcasted: false, clients: 0 };
    const result = BroadcastEventResponseSchema.parse(data);
    expect(result.broadcasted).toBe(false);
  });

  test('異常系: broadcasted が boolean でないと ZodError', () => {
    const data = { broadcasted: 'yes', clients: 1 };
    expect(() => BroadcastEventResponseSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: HealthStatus', () => {
  test('正常系: ヘルスステータスをパースできる', () => {
    const data = {
      status: 'healthy',
      version: '1.0.0',
      kernels_active: 2,
    };

    const result = HealthStatusSchema.parse(data);
    expect(result.status).toBe('healthy');
  });

  test('異常系: status が不正な値だと ZodError', () => {
    const data = {
      status: 'unknown',
      version: '1.0.0',
      kernels_active: 0,
    };

    expect(() => HealthStatusSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: WorkspaceInfo', () => {
  test('正常系: ワークスペース情報をパースできる', () => {
    const data = {
      workspace_id: 'ws-123',
      name: 'Test Workspace',
      path: '/workspaces/ws-123',
      data_path: '/workspaces/ws-123/data',
      output_path: '/workspaces/ws-123/output',
      created_at: '2026-01-01T00:00:00Z',
      summary: 'Test workspace for analysis',
      status: 'in_progress',
    };

    const result = WorkspaceInfoSchema.parse(data);
    expect(result.workspace_id).toBe('ws-123');
    expect(result.status).toBe('in_progress');
  });

  test('正常系: file_count はオプショナル', () => {
    const data = {
      workspace_id: 'ws-123',
      name: 'Test',
      path: '/workspaces/ws-123',
      data_path: '/workspaces/ws-123/data',
      output_path: '/workspaces/ws-123/output',
      created_at: '2026-01-01T00:00:00Z',
      summary: '',
      status: 'not_started',
      file_count: 5,
    };

    const result = WorkspaceInfoSchema.parse(data);
    expect(result.file_count).toBe(5);
  });

  test('異常系: status が不正な値だと ZodError', () => {
    const data = {
      workspace_id: 'ws-123',
      name: 'Test',
      path: '/workspaces/ws-123',
      data_path: '/workspaces/ws-123/data',
      output_path: '/workspaces/ws-123/output',
      created_at: '2026-01-01T00:00:00Z',
      summary: '',
      status: 'invalid_status',
    };

    expect(() => WorkspaceInfoSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: WorkspaceSummarizeResponse', () => {
  test('正常系: サマリテンプレートをパースできる', () => {
    const data = {
      workspace_id: 'ws-123',
      template: 'Summary template here',
      verification_criteria: 'Criteria text',
      instructions: 'Instructions text',
    };

    const result = WorkspaceSummarizeResponseSchema.parse(data);
    expect(result.workspace_id).toBe('ws-123');
  });
});

describe('zod スキーマ: WorkspaceSessionInfo', () => {
  test('正常系: セッション情報をパースできる', () => {
    const data = {
      session_id: 'session-123',
      kernel_id: 'kernel-456',
      workspace_id: 'ws-789',
      status: 'idle',
      created_at: '2026-01-01T00:00:00Z',
    };

    const result = WorkspaceSessionInfoSchema.parse(data);
    expect(result.session_id).toBe('session-123');
  });

  test('正常系: オプショナルフィールド付きでパースできる', () => {
    const data = {
      session_id: 'session-123',
      kernel_id: 'kernel-456',
      workspace_id: 'ws-789',
      notebook_path: 'analysis.ipynb',
      status: 'idle',
      created_at: '2026-01-01T00:00:00Z',
      browser_url: 'http://localhost:8888/lab',
    };

    const result = WorkspaceSessionInfoSchema.parse(data);
    expect(result.notebook_path).toBe('analysis.ipynb');
    expect(result.browser_url).toContain('localhost');
  });
});

describe('zod スキーマ: CreateContentResponse', () => {
  test('正常系: コンテンツ作成レスポンスをパースできる', () => {
    const data = {
      path: 'analysis.ipynb',
      type: 'notebook',
      created_at: '2026-01-01T00:00:00Z',
    };

    const result = CreateContentResponseSchema.parse(data);
    expect(result.path).toBe('analysis.ipynb');
  });
});

describe('zod スキーマ: SqlExecuteResponse', () => {
  test('正常系: SELECT 結果をパースできる', () => {
    const data = {
      success: true,
      execution_time_ms: 200,
      file_path: 'workspaces/ws-123/data/result.csv',
      row_count: 100,
      columns: ['id', 'name', 'value'],
      file_size_bytes: 4096,
      truncated: false,
    };

    const result = SqlExecuteResponseSchema.parse(data);
    expect(result.success).toBe(true);
    expect(result.row_count).toBe(100);
  });

  test('正常系: 非 SELECT 結果をパースできる', () => {
    const data = {
      success: true,
      execution_time_ms: 50,
      affected_rows: 10,
    };

    const result = SqlExecuteResponseSchema.parse(data);
    expect(result.affected_rows).toBe(10);
  });
});

describe('zod スキーマ: SqlExportResponse', () => {
  test('正常系: エクスポート結果をパースできる', () => {
    const data = {
      success: true,
      file_path: 'workspaces/ws-123/output/export.parquet',
      row_count: 1000,
      file_size_bytes: 51200,
      format: 'parquet',
      execution_time_ms: 500,
    };

    const result = SqlExportResponseSchema.parse(data);
    expect(result.format).toBe('parquet');
  });
});

describe('zod スキーマ: CellExecuteResponse', () => {
  test('正常系: セル実行結果をパースできる', () => {
    const data = {
      cell_index: 0,
      source: 'print("hello")',
      execution_count: 1,
      outputs: [{ output_type: 'stream', name: 'stdout', text: 'hello\n' }],
      execution_time_ms: 100,
    };

    const result = CellExecuteResponseSchema.parse(data);
    expect(result.cell_index).toBe(0);
    expect(result.outputs).toHaveLength(1);
  });
});

describe('zod スキーマ: CellExecuteBatchResponse', () => {
  test('正常系: バッチ実行結果をパースできる', () => {
    const data = {
      executed_cells: 5,
      success_count: 5,
      failed_cell: null,
    };

    const result = CellExecuteBatchResponseSchema.parse(data);
    expect(result.executed_cells).toBe(5);
    expect(result.failed_cell).toBeNull();
  });

  test('正常系: 失敗セルありの結果をパースできる', () => {
    const data = {
      executed_cells: 3,
      success_count: 2,
      failed_cell: 2,
      error: {
        type: 'RuntimeError',
        message: 'division by zero',
        traceback: ['Traceback...'],
      },
    };

    const result = CellExecuteBatchResponseSchema.parse(data);
    expect(result.failed_cell).toBe(2);
    expect(result.error?.type).toBe('RuntimeError');
  });
});

describe('zod スキーマ: ClearAllOutputsResponse', () => {
  test('正常系: 出力クリア結果をパースできる', () => {
    const data = { cleared_cells: 10 };
    const result = ClearAllOutputsResponseSchema.parse(data);
    expect(result.cleared_cells).toBe(10);
  });
});

describe('zod スキーマ: DataPreviewResponse', () => {
  test('正常系: データプレビューをパースできる', () => {
    const data = {
      path: 'workspaces/ws-123/data/sales.csv',
      format: 'csv',
      row_count: 1000,
      columns: [
        { name: 'id', dtype: 'int64' },
        { name: 'name', dtype: 'object' },
      ],
      head: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      file_size_bytes: 8192,
    };

    const result = DataPreviewResponseSchema.parse(data);
    expect(result.columns).toHaveLength(2);
    expect(result.head).toHaveLength(2);
  });

  test('異常系: format が不正な値だと ZodError', () => {
    const data = {
      path: 'data.json',
      format: 'json',
      row_count: 100,
      columns: [],
      head: [],
      file_size_bytes: 1024,
    };

    expect(() => DataPreviewResponseSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: TextFileResponse', () => {
  test('正常系: テキストファイルレスポンスをパースできる', () => {
    const data = {
      path: 'workspaces/ws-123/data/notes.txt',
      type: 'file',
      content: 'Hello, world!',
      modified_at: '2026-01-01T00:00:00Z',
    };

    const result = TextFileResponseSchema.parse(data);
    expect(result.content).toBe('Hello, world!');
  });

  test('異常系: type が file でないと ZodError', () => {
    const data = {
      path: 'analysis.ipynb',
      type: 'notebook',
      content: '{}',
      modified_at: '2026-01-01T00:00:00Z',
    };

    expect(() => TextFileResponseSchema.parse(data)).toThrow();
  });
});

describe('zod スキーマ: 境界ケース', () => {
  test('余分なフィールドがあってもパースできる（strip）', () => {
    const data = {
      broadcasted: true,
      clients: 1,
      extra_field: 'should be ignored',
    };

    const result = BroadcastEventResponseSchema.parse(data);
    expect(result.broadcasted).toBe(true);
    // extra_field は結果に含まれないことを確認
    expect('extra_field' in result).toBe(false);
  });

  test('完全に不正なデータ（null）は ZodError', () => {
    expect(() => KernelSchema.parse(null)).toThrow();
  });

  test('完全に不正なデータ（string）は ZodError', () => {
    expect(() => ExecuteResultSchema.parse('not an object')).toThrow();
  });

  test('完全に不正なデータ（number）は ZodError', () => {
    expect(() => JupyterSessionSchema.parse(42)).toThrow();
  });
});
