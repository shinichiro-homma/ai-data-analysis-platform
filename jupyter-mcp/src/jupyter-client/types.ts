/**
 * jupyter-server API の型定義
 */

// =============================================================================
// カーネル関連
// =============================================================================

export type KernelStatus = 'starting' | 'idle' | 'busy' | 'dead';

export interface Kernel {
  id: string;
  name: string;
  status: KernelStatus;
  started_at: string;
  execution_count?: number;
}

export interface CreateKernelRequest {
  name?: string;
}

export interface DeleteKernelResponse {
  id: string;
  status: 'deleted';
}

// =============================================================================
// セッション関連
// =============================================================================

// Jupyter Server の /api/sessions が返すセッション情報
export interface JupyterSession {
  id: string;
  path: string;           // ノートブックパス
  name: string;           // ノートブック名
  type: 'notebook';
  kernel: {
    id: string;
    name: string;
    last_activity: string;
    execution_state: KernelStatus;
    connections: number;
  };
}

// セッション作成リクエスト
export interface CreateSessionRequest {
  name: string;        // ノートブック名
  path: string;        // ノートブックパス
  type: 'notebook';
  kernel: {
    name: string;      // カーネル名（例: "python3"）
  };
}

// =============================================================================
// コード実行関連
// =============================================================================

export interface ExecuteRequest {
  code: string;
  timeout?: number;
}

export interface Output {
  type: 'stdout' | 'stderr';
  text: string;
}

export interface ImageOutput {
  id: string;
  mime_type: string;
  data: string;
  width?: number;
  height?: number;
}

export interface ExecutionError {
  type: string;
  message: string;
  traceback: string[];
}

export interface ExecuteResult {
  success: boolean;
  execution_count: number;
  outputs: Output[];
  result: unknown | null;
  images: ImageOutput[];
  execution_time_ms: number;
  error?: ExecutionError;
}

// =============================================================================
// 変数関連
// =============================================================================

export interface Variable {
  name: string;
  type: string;
  value?: unknown;
  size?: string;
  memory_bytes?: number;
}

export interface DataFrameColumn {
  name: string;
  dtype: string;
}

export interface DataFrameDescribe {
  [columnName: string]: {
    count?: number;
    mean?: number;
    std?: number;
    min?: number;
    max?: number;
  };
}

export interface DataFrameVariable extends Variable {
  shape: [number, number];
  columns: DataFrameColumn[];
  head: Record<string, unknown>[];
  describe: DataFrameDescribe;
}

// =============================================================================
// ノートブック・ファイル関連
// =============================================================================

export type ContentType = 'notebook' | 'file' | 'directory';

export interface ContentItem {
  name: string;
  type: ContentType;
  size?: number;
  modified_at: string;
}

export interface ContentsListResponse {
  path: string;
  contents: ContentItem[];
}

export interface Cell {
  cell_type: 'code' | 'markdown';
  source: string;
  outputs?: unknown[];
  execution_count?: number | null;
}

export interface NotebookMetadata {
  kernel?: string;
}

export interface NotebookContent {
  cells: Cell[];
  metadata: NotebookMetadata;
}

export interface NotebookResponse {
  path: string;
  type: 'notebook';
  content: NotebookContent;
  modified_at: string;
}

export interface CreateContentRequest {
  type: ContentType;
  path: string;
}

export interface CreateContentResponse {
  path: string;
  type: ContentType;
  created_at: string;
}

export interface UpdateNotebookRequest {
  content: NotebookContent;
}

export type CellAction = 'add' | 'update' | 'delete';

export interface CellOperationRequest {
  action: CellAction;
  cell?: Cell;
  index?: number;
}

// =============================================================================
// ヘルスチェック
// =============================================================================

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  version: string;
  kernels_active: number;
}

// =============================================================================
// API レスポンスラッパー
// =============================================================================

export interface ApiResponse<T> {
  data: T;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// =============================================================================
// クライアント設定
// =============================================================================

export interface JupyterClientConfig {
  baseUrl?: string;
  token?: string;
  timeout?: number;
}
