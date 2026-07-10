/**
 * API レスポンス型の zod スキーマ
 *
 * types.ts の interface に対応する zod スキーマを定義する。
 * client.ts のデータ返却メソッドで境界検証に使用する。
 */

import { z } from 'zod';

// =============================================================================
// カーネル関連
// =============================================================================

const KernelStatusEnum = z.enum(['starting', 'idle', 'busy', 'dead']);

export const KernelSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    status: KernelStatusEnum,
    started_at: z.string().optional(),
    execution_count: z.number().optional(),
  })
  .strip();

export const DeleteKernelResponseSchema = z
  .object({
    id: z.string(),
    status: z.literal('deleted'),
  })
  .strip();

// =============================================================================
// セッション関連
// =============================================================================

export const JupyterSessionSchema = z
  .object({
    id: z.string(),
    path: z.string(),
    name: z.string(),
    type: z.literal('notebook'),
    kernel: z
      .object({
        id: z.string(),
        name: z.string(),
        last_activity: z.string(),
        execution_state: KernelStatusEnum,
        connections: z.number(),
      })
      .strip(),
  })
  .strip();

// =============================================================================
// コード実行関連
// =============================================================================

const OutputSchema = z.object({
  type: z.enum(['stdout', 'stderr']),
  text: z.string(),
});

const ImageOutputSchema = z.object({
  file_path: z.string().nullable(),
  mime_type: z.string(),
  description: z.string(),
});

const ExecutionErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
  traceback: z.array(z.string()),
});

export const ExecuteResultSchema = z
  .object({
    success: z.boolean(),
    execution_count: z.number(),
    outputs: z.array(OutputSchema),
    result: z.unknown(),
    images: z.array(ImageOutputSchema),
    execution_time_ms: z.number(),
    error: ExecutionErrorSchema.optional(),
  })
  .strip();

// =============================================================================
// 変数関連
// =============================================================================

export const VariableSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    value: z.unknown().optional(),
    size: z.string().optional(),
    memory_bytes: z.number().optional(),
  })
  .strip();

// =============================================================================
// ノートブック・ファイル関連
// =============================================================================

const ContentTypeEnum = z.enum(['notebook', 'file', 'directory']);

const ContentItemSchema = z.object({
  name: z.string(),
  type: ContentTypeEnum,
  size: z.number().optional(),
  modified_at: z.string(),
});

export const ContentsListResponseSchema = z
  .object({
    path: z.string(),
    contents: z.array(ContentItemSchema),
  })
  .strip();

const CellOutputDataSchema = z.union([
  z.object({ output_type: z.literal('stream'), name: z.enum(['stdout', 'stderr']), text: z.string() }),
  z.object({
    output_type: z.literal('display_data'),
    data: z.record(z.string(), z.string()),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.object({
    output_type: z.literal('execute_result'),
    execution_count: z.number(),
    data: z.record(z.string(), z.string()),
    metadata: z.record(z.string(), z.unknown()),
  }),
  z.object({
    output_type: z.literal('error'),
    ename: z.string(),
    evalue: z.string(),
    traceback: z.array(z.string()),
  }),
]);

const CellSchema = z.object({
  cell_type: z.enum(['code', 'markdown']),
  source: z.string(),
  outputs: z.array(CellOutputDataSchema).optional(),
  execution_count: z.number().nullable().optional(),
});

const NotebookMetadataSchema = z.object({
  kernel: z.string().optional(),
});

const NotebookContentSchema = z.object({
  cells: z.array(CellSchema),
  metadata: NotebookMetadataSchema,
});

export const NotebookResponseSchema = z
  .object({
    path: z.string(),
    type: z.literal('notebook'),
    content: NotebookContentSchema,
    modified_at: z.string(),
  })
  .strip();

export const CreateContentResponseSchema = z
  .object({
    path: z.string(),
    type: ContentTypeEnum,
    created_at: z.string(),
  })
  .strip();

// =============================================================================
// ワークスペース関連
// =============================================================================

const WorkspaceStatusEnum = z.enum(['not_started', 'in_progress', 'completed', 'blocked']);

export const WorkspaceInfoSchema = z
  .object({
    workspace_id: z.string(),
    name: z.string(),
    path: z.string(),
    data_path: z.string(),
    output_path: z.string(),
    created_at: z.string(),
    summary: z.string(),
    status: WorkspaceStatusEnum,
    file_count: z.number().optional(),
  })
  .strip();

export const WorkspaceSummarizeResponseSchema = z
  .object({
    workspace_id: z.string(),
    template: z.string(),
    verification_criteria: z.string(),
    instructions: z.string(),
  })
  .strip();

export const WorkspaceSessionInfoSchema = z
  .object({
    session_id: z.string(),
    kernel_id: z.string(),
    workspace_id: z.string(),
    notebook_path: z.string().optional(),
    status: KernelStatusEnum,
    created_at: z.string(),
    browser_url: z.string().optional(),
  })
  .strip();

// =============================================================================
// ヘルスチェック
// =============================================================================

export const HealthStatusSchema = z
  .object({
    status: z.enum(['healthy', 'unhealthy']),
    version: z.string(),
    kernels_active: z.number(),
  })
  .strip();

// =============================================================================
// AI同期イベント
// =============================================================================

export const BroadcastEventResponseSchema = z
  .object({
    broadcasted: z.boolean(),
    clients: z.number(),
  })
  .strip();

// =============================================================================
// SQL実行関連
// =============================================================================

export const SqlExecuteResponseSchema = z
  .object({
    success: z.boolean(),
    execution_time_ms: z.number(),
    file_path: z.string().optional(),
    row_count: z.number().optional(),
    columns: z.array(z.string()).optional(),
    file_size_bytes: z.number().optional(),
    truncated: z.boolean().optional(),
    affected_rows: z.number().optional(),
  })
  .strip();

export const SqlExportResponseSchema = z
  .object({
    success: z.boolean(),
    file_path: z.string(),
    row_count: z.number(),
    file_size_bytes: z.number(),
    format: z.enum(['parquet', 'csv']),
    execution_time_ms: z.number(),
  })
  .strip();

// =============================================================================
// セル再実行関連
// =============================================================================

export const CellExecuteResponseSchema = z
  .object({
    cell_index: z.number(),
    source: z.string(),
    execution_count: z.number(),
    outputs: z.array(CellOutputDataSchema),
    execution_time_ms: z.number(),
  })
  .strip();

// =============================================================================
// セル一括実行関連
// =============================================================================

export const CellExecuteBatchResponseSchema = z
  .object({
    executed_cells: z.number(),
    success_count: z.number(),
    failed_cell: z.number().nullable(),
    error: ExecutionErrorSchema.optional(),
  })
  .strip();

// =============================================================================
// 出力クリア関連
// =============================================================================

export const ClearAllOutputsResponseSchema = z
  .object({
    cleared_cells: z.number(),
  })
  .strip();

// =============================================================================
// データプレビュー関連
// =============================================================================

const DataPreviewColumnSchema = z.object({
  name: z.string(),
  dtype: z.string(),
});

export const DataPreviewResponseSchema = z
  .object({
    path: z.string(),
    format: z.enum(['csv', 'parquet']),
    row_count: z.number(),
    columns: z.array(DataPreviewColumnSchema),
    head: z.array(z.record(z.string(), z.unknown())),
    file_size_bytes: z.number(),
  })
  .strip();

// =============================================================================
// テキストファイル読み取り関連
// =============================================================================

export const TextFileResponseSchema = z
  .object({
    path: z.string(),
    type: z.literal('file'),
    content: z.string(),
    modified_at: z.string(),
  })
  .strip();
