/**
 * jupyter-server HTTP クライアント
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Kernel,
  CreateKernelRequest,
  DeleteKernelResponse,
  JupyterSession,
  CreateSessionRequest,
  ExecuteRequest,
  ExecuteResult,
  Variable,
  DataFrameVariable,
  ContentsListResponse,
  NotebookResponse,
  CreateContentRequest,
  CreateContentResponse,
  UpdateNotebookRequest,
  CellOperationRequest,
  WorkspaceInfo,
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  WorkspaceSummarizeResponse,
  CreateWorkspaceSessionRequest,
  WorkspaceSessionInfo,
  FileContent,
  SqlExecuteRequest,
  SqlExecuteResponse,
  SqlExportRequest,
  SqlExportResponse,
  HealthStatus,
  ApiResponse,
  ApiError,
  JupyterClientConfig,
  AiEvent,
  BroadcastEventResponse,
  CellOutputData,
  CellExecuteRequest,
  CellExecuteResponse,
  CellExecuteBatchRequest,
  CellExecuteBatchResponse,
  DataPreviewResponse,
  DataPreviewOptions,
  TextFileResponse,
} from './types.js';
import {
  JupyterClientError,
  ConnectionError,
  UnauthorizedError,
  KernelNotFoundError,
  NotebookNotFoundError,
  createErrorFromResponse,
} from './errors.js';
import { normalizeNotebookPath } from '../utils/path-validator.js';
import { logger } from '../utils/logger.js';

const DEFAULT_BASE_URL = 'http://localhost:8888';
const DEFAULT_TIMEOUT = 300000;

/** Contents API 用パスエンコード: セグメントごとにエンコードし / は保持 */
export function encodeContentsPath(filePath: string): string {
  return filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class JupyterClient {
  private readonly _baseUrl: string;
  private readonly token: string;
  private axios: AxiosInstance;

  get baseUrl(): string {
    return this._baseUrl;
  }

  constructor(config?: JupyterClientConfig) {
    this._baseUrl = config?.baseUrl ?? process.env.JUPYTER_SERVER_URL ?? DEFAULT_BASE_URL;
    this.token = config?.token ?? process.env.JUPYTER_TOKEN ?? '';
    const timeout = config?.timeout ?? DEFAULT_TIMEOUT;

    if (!this.token) {
      logger.warn('[jupyter-client] JUPYTER_TOKEN が設定されていません');
    }

    this.axios = axios.create({
      baseURL: this._baseUrl,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
  }

  // ===========================================================================
  // ヘルスチェック
  // ===========================================================================

  async healthCheck(): Promise<HealthStatus> {
    const response = await this.request<HealthStatus>('GET', '/health');
    return response;
  }

  // ===========================================================================
  // カーネル管理
  // ===========================================================================

  async createKernel(name = 'python3'): Promise<Kernel> {
    const body: CreateKernelRequest = { name };
    const response = await this.request<ApiResponse<Kernel>>('POST', '/api/kernels', body);
    return response.data;
  }

  async listKernels(): Promise<Kernel[]> {
    const response = await this.request<ApiResponse<{ kernels: Kernel[] }>>('GET', '/api/kernels');
    return response.data.kernels;
  }

  async getKernel(kernelId: string): Promise<Kernel> {
    const response = await this.request<ApiResponse<Kernel>>('GET', `/api/kernels/${kernelId}`, undefined, {
      kernelId,
    });
    return response.data;
  }

  async deleteKernel(kernelId: string): Promise<DeleteKernelResponse> {
    const response = await this.request<ApiResponse<DeleteKernelResponse>>(
      'DELETE',
      `/api/kernels/${kernelId}`,
      undefined,
      { kernelId },
    );
    return response.data;
  }

  async interruptKernel(kernelId: string): Promise<Kernel> {
    const response = await this.request<ApiResponse<Kernel>>('POST', `/api/kernels/${kernelId}/interrupt`, undefined, {
      kernelId,
    });
    return response.data;
  }

  async restartKernel(kernelId: string): Promise<Kernel> {
    const response = await this.request<ApiResponse<Kernel>>('POST', `/api/kernels/${kernelId}/restart`, undefined, {
      kernelId,
    });
    return response.data;
  }

  // ===========================================================================
  // セッション管理
  // ===========================================================================

  // セッション一覧を取得（ノートブックとカーネルの対応関係）
  // 注意: /api/sessions は標準APIなので ApiResponse ラッパーなし
  async listSessions(): Promise<JupyterSession[]> {
    const response = await this.request<JupyterSession[]>('GET', '/api/sessions');
    return response;
  }

  // 指定パスのノートブックに関連するセッションを取得
  async getSessionByPath(notebookPath: string): Promise<JupyterSession | null> {
    const sessions = await this.listSessions();
    // パス正規化（セキュリティチェック含む）
    const normalizedPath = normalizeNotebookPath(notebookPath);
    return (
      sessions.find((s) => {
        const sessionPath = normalizeNotebookPath(s.path);
        return sessionPath === normalizedPath;
      }) ?? null
    );
  }

  // 指定カーネルIDに関連するセッションを取得
  async getSessionByKernelId(kernelId: string): Promise<JupyterSession | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.kernel.id === kernelId) ?? null;
  }

  /**
   * セッションを作成する（ノートブックとカーネルを関連付け）
   * 注意: /api/sessions は標準APIなので ApiResponse ラッパーなし
   */
  async createSession(notebookPath: string, kernelName = 'python3'): Promise<JupyterSession> {
    // パス正規化（セキュリティチェック含む）
    const normalizedPath = normalizeNotebookPath(notebookPath);
    // ファイル名を抽出
    const name = normalizedPath.split('/').pop() ?? normalizedPath;

    const body: CreateSessionRequest = {
      name,
      path: normalizedPath,
      type: 'notebook',
      kernel: { name: kernelName },
    };

    const response = await this.request<JupyterSession>('POST', '/api/sessions', body);
    return response;
  }

  // ===========================================================================
  // コード実行
  // ===========================================================================

  async executeCode(kernelId: string, request: ExecuteRequest): Promise<ExecuteResult> {
    const requestTimeoutMs = this.calculateRequestTimeout(request.timeout);
    const response = await this.request<ApiResponse<ExecuteResult>>(
      'POST',
      `/api/kernels/${kernelId}/execute`,
      request,
      { kernelId },
      requestTimeoutMs,
    );
    return response.data;
  }

  // ===========================================================================
  // 変数管理
  // ===========================================================================

  async getVariables(kernelId: string): Promise<Variable[]> {
    const response = await this.request<ApiResponse<{ variables: Variable[] }>>(
      'GET',
      `/api/kernels/${kernelId}/variables`,
      undefined,
      { kernelId },
    );
    return response.data.variables;
  }

  async getVariable(kernelId: string, name: string): Promise<Variable | DataFrameVariable> {
    const response = await this.request<ApiResponse<Variable | DataFrameVariable>>(
      'GET',
      `/api/kernels/${kernelId}/variables/${encodeURIComponent(name)}`,
      undefined,
      { kernelId },
    );
    return response.data;
  }

  // ===========================================================================
  // ファイル・ノートブック管理
  // ===========================================================================

  async listContents(path = '/'): Promise<ContentsListResponse> {
    const queryString = path === '/' ? '' : `?path=${encodeURIComponent(path)}`;
    const response = await this.request<ApiResponse<ContentsListResponse>>('GET', `/api/custom/contents${queryString}`);
    return response.data;
  }

  async getContents(path: string): Promise<NotebookResponse> {
    const response = await this.request<ApiResponse<NotebookResponse>>(
      'GET',
      `/api/custom/contents/${encodeURIComponent(path)}`,
      undefined,
      { path },
    );
    return response.data;
  }

  async createNotebook(path: string): Promise<CreateContentResponse> {
    const body: CreateContentRequest = {
      type: 'notebook',
      path,
    };
    const response = await this.request<ApiResponse<CreateContentResponse>>('POST', '/api/custom/contents', body);
    return response.data;
  }

  async updateNotebook(path: string, content: UpdateNotebookRequest): Promise<void> {
    await this.request<ApiResponse<unknown>>('PUT', `/api/custom/contents/${encodeURIComponent(path)}`, content, {
      path,
    });
  }

  async operateCell(path: string, operation: CellOperationRequest): Promise<void> {
    await this.request<ApiResponse<unknown>>(
      'PATCH',
      `/api/custom/contents/${encodeURIComponent(path)}/cells`,
      operation,
      { path, index: operation.index },
    );
  }

  /**
   * セルの出力と実行カウントを更新する（セル実行結果の永続化用）
   */
  async updateCellOutputs(
    path: string,
    cellIndex: number,
    outputs: CellOutputData[],
    executionCount: number,
  ): Promise<void> {
    const operation: CellOperationRequest = {
      action: 'update',
      index: cellIndex,
      cell: {
        outputs,
        execution_count: executionCount,
      },
    };

    await this.request<ApiResponse<unknown>>(
      'PATCH',
      `/api/custom/contents/${encodeURIComponent(path)}/cells`,
      operation,
      { path, index: cellIndex },
    );
  }

  /**
   * ファイル内容を取得する（バイナリファイルは base64 エンコードで返却）。
   * Jupyter Contents API: GET /api/contents/{path}?content=1&type=file
   */
  async getFileContent(path: string): Promise<FileContent> {
    const response = await this.request<{ content: string; mimetype: string }>(
      'GET',
      `/api/contents/${encodeContentsPath(path)}`,
      undefined,
      { path },
    );
    return {
      content: response.content,
      mimetype: response.mimetype,
    };
  }

  async deleteContents(path: string): Promise<void> {
    await this.request<ApiResponse<unknown>>('DELETE', `/api/custom/contents/${encodeURIComponent(path)}`, undefined, {
      path,
    });
  }

  // ===========================================================================
  // ワークスペース管理
  // ===========================================================================

  async createWorkspace(name: string, summary?: string, status?: string): Promise<WorkspaceInfo> {
    const body: CreateWorkspaceRequest = {
      name,
      ...(summary !== undefined ? { summary } : {}),
      ...(status !== undefined ? { status: status as CreateWorkspaceRequest['status'] } : {}),
    };
    const response = await this.request<ApiResponse<WorkspaceInfo>>('POST', '/api/workspaces', body);
    return response.data;
  }

  async listWorkspaces(): Promise<WorkspaceInfo[]> {
    const response = await this.request<ApiResponse<{ workspaces: WorkspaceInfo[] }>>('GET', '/api/workspaces');
    return response.data.workspaces;
  }

  async updateWorkspace(workspaceId: string, params: UpdateWorkspaceRequest): Promise<WorkspaceInfo> {
    const response = await this.request<ApiResponse<WorkspaceInfo>>(
      'PUT',
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      params,
    );
    return response.data;
  }

  async summarizeWorkspace(workspaceId: string): Promise<WorkspaceSummarizeResponse> {
    const response = await this.request<ApiResponse<WorkspaceSummarizeResponse>>(
      'POST',
      `/api/workspaces/${encodeURIComponent(workspaceId)}/summarize`,
    );
    return response.data;
  }

  /**
   * ワークスペース内でカーネルを起動する
   * カーネルの作業ディレクトリ（cwd）がワークスペースディレクトリに設定される
   */
  async createSessionInWorkspace(
    workspaceId: string,
    notebookPath?: string,
    kernelName?: string,
  ): Promise<WorkspaceSessionInfo> {
    const body: CreateWorkspaceSessionRequest = {
      workspace_id: workspaceId,
      ...(notebookPath ? { notebook_path: notebookPath } : {}),
      ...(kernelName ? { kernel_name: kernelName } : {}),
    };
    const response = await this.request<ApiResponse<WorkspaceSessionInfo>>('POST', '/api/custom/sessions', body);
    return response.data;
  }

  /**
   * テキストファイルを指定パスに書き込む
   * Jupyter Contents API: PUT /api/contents/{path}
   */
  async writeTextFile(filePath: string, content: string): Promise<void> {
    await this.request<unknown>('PUT', `/api/contents/${encodeContentsPath(filePath)}`, {
      type: 'file',
      format: 'text',
      content,
    });
  }

  /**
   * ディレクトリを作成する（存在しない場合）
   * Jupyter Contents API: PUT /api/contents/{path}
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    await this.request<unknown>('PUT', `/api/contents/${encodeContentsPath(dirPath)}`, {
      type: 'directory',
    });
  }

  // ===========================================================================
  // SQL実行
  // ===========================================================================

  async executeSql(params: SqlExecuteRequest): Promise<SqlExecuteResponse> {
    const requestTimeoutMs = this.calculateRequestTimeout(params.timeout);
    const response = await this.request<ApiResponse<SqlExecuteResponse>>(
      'POST',
      '/api/sql/execute',
      params,
      undefined,
      requestTimeoutMs,
    );
    return response.data;
  }

  async exportSql(params: SqlExportRequest): Promise<SqlExportResponse> {
    const requestTimeoutMs = this.calculateRequestTimeout(params.timeout);
    const response = await this.request<ApiResponse<SqlExportResponse>>(
      'POST',
      '/api/sql/export',
      params,
      undefined,
      requestTimeoutMs,
    );
    return response.data;
  }

  // ===========================================================================
  // セル再実行
  // ===========================================================================

  async executeCellInNotebook(
    path: string,
    cellIndex: number,
    request: CellExecuteRequest,
  ): Promise<CellExecuteResponse> {
    const requestTimeoutMs = this.calculateRequestTimeout(request.timeout);
    const response = await this.request<ApiResponse<CellExecuteResponse>>(
      'POST',
      `/api/custom/contents/${encodeURIComponent(path)}/cells/${cellIndex}/execute`,
      request,
      { path, index: cellIndex },
      requestTimeoutMs,
    );
    return response.data;
  }

  // ===========================================================================
  // セル一括実行
  // ===========================================================================

  async executeBatchCells(path: string, request: CellExecuteBatchRequest): Promise<CellExecuteBatchResponse> {
    const requestTimeoutMs = this.calculateRequestTimeout(request.timeout);
    const response = await this.request<ApiResponse<CellExecuteBatchResponse>>(
      'POST',
      `/api/custom/contents/${encodeURIComponent(path)}/cells/execute-batch`,
      request,
      { path },
      requestTimeoutMs,
    );
    return response.data;
  }

  // ===========================================================================
  // データプレビュー
  // ===========================================================================

  async getDataPreview(path: string, options?: DataPreviewOptions): Promise<DataPreviewResponse> {
    const params = new URLSearchParams();
    if (options?.head_rows !== undefined) {
      params.set('head_rows', String(options.head_rows));
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.request<ApiResponse<DataPreviewResponse>>(
      'GET',
      `/api/custom/contents/${encodeContentsPath(path)}/preview${query}`,
      undefined,
      { path },
    );
    return response.data;
  }

  // ===========================================================================
  // テキストファイル読み取り
  // ===========================================================================

  /**
   * テキストファイルの内容を取得する。
   *
   * カスタム Contents API (`/api/custom/contents/{path}`) を使用する。
   * 標準 Jupyter Contents API をラップする `getFileContent`（`GET /api/contents/{path}`）とは異なり、
   * このメソッドはサーバー側のカスタムエンドポイントを通じてテキストファイルを取得する。
   * `getFileContent` がバイナリファイルを base64 で返すのに対して、
   * このメソッドはテキストファイル専用であり、構造化されたレスポンス（TextFileResponse 型）を返す。
   */
  async getTextFileContent(path: string): Promise<TextFileResponse> {
    const response = await this.request<ApiResponse<TextFileResponse>>(
      'GET',
      `/api/custom/contents/${encodeContentsPath(path)}`,
      undefined,
      { path },
    );
    return response.data;
  }

  // ===========================================================================
  // AI同期イベント配信
  // ===========================================================================

  /**
   * AI操作イベントをブロードキャスト
   *
   * 戻り値の clients でブラウザの接続数を確認可能。
   * clients > 0 なら SharedModel 経由で反映されるため REST API 書き込み不要。
   * clients === 0 なら REST API でディスクに直接書き込む必要がある。
   *
   * エラー時は clients: 0 を返す（フォールバックとして REST API 書き込みが実行される）。
   */
  async postAiEvent(event: AiEvent): Promise<BroadcastEventResponse> {
    try {
      const response = await this.request<ApiResponse<BroadcastEventResponse>>(
        'POST',
        '/api/ai/events/broadcast',
        event,
      );
      return response.data;
    } catch (error) {
      // イベント配信失敗時はクライアント0として扱い、REST APIフォールバックを促す
      console.warn('[jupyter-client] AI event broadcast failed:', error instanceof Error ? error.message : error);
      return { broadcasted: false, clients: 0 };
    }
  }

  // ===========================================================================
  // 内部メソッド
  // ===========================================================================

  /**
   * サーバー側のタイムアウト(秒)からHTTPリクエストのタイムアウト(ミリ秒)を算出する。
   * サーバー側のタイムアウトに通信余裕時間(5秒)を加算する。
   */
  private calculateRequestTimeout(timeoutSeconds?: number): number | undefined {
    if (!timeoutSeconds) return undefined;
    return timeoutSeconds * 1000 + 5000;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    context?: { kernelId?: string; path?: string; index?: number },
    timeout?: number,
  ): Promise<T> {
    try {
      const response = await this.axios.request<T>({
        method,
        url: path,
        data: body,
        ...(timeout ? { timeout } : {}),
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error, context);
    }
  }

  private handleError(
    error: unknown,
    context?: { kernelId?: string; path?: string; index?: number },
  ): JupyterClientError {
    if (!(error instanceof AxiosError)) {
      // 予期しないエラー
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new JupyterClientError(errorMessage, 'INTERNAL_ERROR', 500);
    }

    // 接続エラー
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return new ConnectionError(`jupyter-server (${this._baseUrl}) への接続に失敗しました: ${error.message}`);
    }

    // タイムアウト
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ConnectionError('リクエストがタイムアウトしました');
    }

    // HTTP エラーレスポンス
    if (error.response) {
      const statusCode = error.response.status;
      const responseData = error.response.data as ApiError | undefined;

      // 401 Unauthorized
      if (statusCode === 401) {
        return new UnauthorizedError();
      }

      // APIエラーレスポンス形式の場合
      if (responseData?.error) {
        return createErrorFromResponse(statusCode, responseData.error.code, responseData.error.message, context);
      }

      // 404 でコンテキストがある場合
      if (statusCode === 404) {
        if (context?.kernelId) {
          return new KernelNotFoundError(context.kernelId);
        }
        if (context?.path) {
          return new NotebookNotFoundError(context.path);
        }
      }

      // その他のHTTPエラー
      return new JupyterClientError(`HTTP エラー: ${statusCode}`, 'HTTP_ERROR', statusCode);
    }

    // レスポンスなしのエラー
    const errorMessage = error.message || String(error);
    return new JupyterClientError(errorMessage, 'INTERNAL_ERROR', 500);
  }
}

/**
 * シングルトンインスタンス
 * 環境変数から設定を読み込んで初期化
 */
export const jupyterClient = new JupyterClient();
