/**
 * jupyter-server API の型定義
 */

// =============================================================================
// カーネル関連
// =============================================================================

export type KernelStatus = 'starting' | 'idle' | 'busy' | 'dead';

export interface Kernel {
  id: string;
  name?: string;
  status: KernelStatus;
  started_at?: string;
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
  path: string; // ノートブックパス
  name: string; // ノートブック名
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
  name: string; // ノートブック名
  path: string; // ノートブックパス
  type: 'notebook';
  kernel: {
    name: string; // カーネル名（例: "python3"）
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
  file_path: string | null; // workspaces/{workspace_id}/output/exec-{N}-img-{NNN}.{ext} （ワークスペース解決失敗時は null）
  mime_type: string;
  description: string;
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
  result: unknown;
  images: ImageOutput[];
  execution_time_ms: number;
  error?: ExecutionError | null;
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
  size?: number | null;
  modified_at: string;
}

export interface ContentsListResponse {
  path: string;
  contents: ContentItem[];
}

export interface Cell {
  cell_type: 'code' | 'markdown';
  source: string;
  outputs?: CellOutputData[];
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

export type CellAction =
  'add' | 'update' | 'delete' | 'reorder' | 'merge' | 'split' | 'change_type' | 'copy' | 'clear_output';

export interface CellOperationRequest {
  action: CellAction;
  cell?: Partial<Cell>;
  index?: number;
  to_index?: number;
  start_index?: number;
  end_index?: number;
  split_line?: number;
  cell_type?: 'code' | 'markdown';
}

// =============================================================================
// ワークスペース関連
// =============================================================================

export type WorkspaceStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

export interface WorkspaceInfo {
  workspace_id: string;
  name: string;
  path: string;
  data_path: string;
  output_path: string;
  created_at: string;
  summary: string;
  status: WorkspaceStatus;
  file_count?: number;
}

export interface CreateWorkspaceRequest {
  name: string;
  summary?: string;
  status?: WorkspaceStatus;
}

export interface UpdateWorkspaceRequest {
  summary?: string;
  status?: WorkspaceStatus;
}

export interface WorkspaceSummarizeResponse {
  workspace_id: string;
  template: string;
  verification_criteria: string;
  instructions: string;
}

// カスタムセッション作成リクエスト（ワークスペース対応）
export interface CreateWorkspaceSessionRequest {
  workspace_id: string;
  notebook_path?: string;
  kernel_name?: string;
}

// カスタムセッション作成レスポンス
export interface WorkspaceSessionInfo {
  session_id: string;
  kernel_id: string;
  workspace_id: string;
  notebook_path?: string;
  status: KernelStatus;
  created_at: string;
  browser_url?: string;
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
// AI同期イベント
// =============================================================================

/**
 * AI同期イベントの基底型
 *
 * タスク 21.3: 差分イベント配信を廃止し、5 種に縮約。
 * notebook_changed / lock_acquired / lock_released / cell_execute_start / cell_execute_end
 */
export interface AiEventBase {
  type: 'notebook_changed' | 'cell_execute_start' | 'cell_execute_end' | 'lock_acquired' | 'lock_released';
}

/**
 * ノートブック変更イベント
 * jupyter-server が .ipynb 保存成功時に配信する。
 * ブラウザ（jupyterlab-ai-sync）は context.revert() でディスクから再読込する。
 */
export interface NotebookChangedEvent extends AiEventBase {
  type: 'notebook_changed';
  notebook_path: string;
  seq: number;
}

/**
 * セル実行開始イベント（ephemeral 通知）
 * AIが execute_code ツールを実行した際に配信される
 */
export interface CellExecuteStartEvent extends AiEventBase {
  type: 'cell_execute_start';
  notebook_path: string;
  cell_index: number;
}

/**
 * セル出力のデータ型
 */
export type CellOutputData =
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: string }
  | { output_type: 'display_data'; data: Record<string, string>; metadata: Record<string, unknown> }
  | {
      output_type: 'execute_result';
      execution_count: number;
      data: Record<string, string>;
      metadata: Record<string, unknown>;
    }
  | { output_type: 'error'; ename: string; evalue: string; traceback: string[] };

/**
 * セル実行完了イベント（ephemeral 通知）
 * コード実行が完了した際に配信される
 */
export interface CellExecuteEndEvent extends AiEventBase {
  type: 'cell_execute_end';
  notebook_path: string;
  cell_index: number;
  execution_count: number;
  success: boolean;
}

/**
 * ノートブックロック取得イベント
 * jupyter-server がロック取得（POST /api/ai/locks）成功時に配信する。
 * ブラウザ（jupyterlab-ai-sync）は該当ノートブックを readOnly 表示にする。
 */
export interface LockAcquiredEvent extends AiEventBase {
  type: 'lock_acquired';
  notebook_path: string;
}

/**
 * ノートブックロック解放イベント
 * jupyter-server がロック解放または TTL 失効時に配信する。
 * ブラウザ（jupyterlab-ai-sync）は該当ノートブックの readOnly 表示を解除する。
 */
export interface LockReleasedEvent extends AiEventBase {
  type: 'lock_released';
  notebook_path: string;
}

/**
 * AI同期イベントの型定義（タスク 21.3: 5 種に縮約）
 */
export type AiEvent =
  NotebookChangedEvent | CellExecuteStartEvent | CellExecuteEndEvent | LockAcquiredEvent | LockReleasedEvent;

export interface BroadcastEventResponse {
  broadcasted: boolean;
  clients: number;
}

/**
 * ノートブックロック取得/延長のレスポンス（タスク 21.2）。
 */
export interface LockResponse {
  lockToken: string;
  expiresAt: number;
}

// =============================================================================
// セル再実行関連
// =============================================================================

export interface CellExecuteRequest {
  kernel_id: string;
  timeout?: number;
}

export interface CellExecuteResponse {
  cell_index: number;
  source: string;
  execution_count: number;
  outputs: CellOutputData[];
  execution_time_ms: number;
}

// =============================================================================
// SQL実行関連
// =============================================================================

export interface SqlExecuteRequest {
  sql: string;
  workspace_id: string;
  filename: string;
  timeout?: number;
  max_rows?: number;
}

export interface SqlExecuteResponse {
  success: boolean;
  execution_time_ms: number;
  // SELECT 時のみ
  file_path?: string;
  row_count?: number;
  columns?: string[];
  file_size_bytes?: number;
  truncated?: boolean;
  // 非SELECT 時のみ
  affected_rows?: number;
}

// =============================================================================
// SQLエクスポート関連
// =============================================================================

export interface SqlExportRequest {
  sql: string;
  workspace_id: string;
  file_path: string;
  format?: 'parquet' | 'csv';
  timeout?: number;
}

export interface SqlExportResponse {
  success: boolean;
  file_path: string;
  row_count: number;
  file_size_bytes: number;
  format: 'parquet' | 'csv';
  execution_time_ms: number;
}

// =============================================================================
// ファイルコンテンツ取得
// =============================================================================

export interface FileContent {
  content: string; // base64 encoded for binary files
  mimetype: string;
}

// =============================================================================
// データプレビュー関連
// =============================================================================

export interface DataPreviewColumn {
  name: string;
  dtype: string;
}

export interface DataPreviewResponse {
  path: string;
  format: 'csv' | 'parquet';
  row_count: number;
  columns: DataPreviewColumn[];
  head: Record<string, unknown>[];
  file_size_bytes: number;
}

export interface DataPreviewOptions {
  head_rows?: number;
}

// =============================================================================
// テキストファイル読み取り関連
// =============================================================================

export interface TextFileResponse {
  path: string;
  type: 'file';
  content: string;
  modified_at: string;
}

// =============================================================================
// セル一括実行関連
// =============================================================================

export interface CellExecuteBatchRequest {
  kernel_id: string;
  mode: 'all' | 'up_to' | 'from';
  cell_index?: number;
  timeout?: number;
}

export interface CellExecuteBatchResponse {
  executed_cells: number;
  success_count: number;
  failed_cell: number | null;
  error?: ExecutionError | null;
}

// =============================================================================
// 出力クリア関連
// =============================================================================

export interface ClearAllOutputsResponse {
  cleared_cells: number;
}

// =============================================================================
// クライアント設定
// =============================================================================

export interface JupyterClientConfig {
  baseUrl?: string;
  token?: string;
  timeout?: number;
}
