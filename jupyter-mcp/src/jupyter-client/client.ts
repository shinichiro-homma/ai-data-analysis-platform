/**
 * jupyter-server HTTP クライアント
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  Kernel,
  CreateKernelRequest,
  DeleteKernelResponse,
  JupyterSession,
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
  HealthStatus,
  ApiResponse,
  ApiError,
  JupyterClientConfig,
} from './types.js';
import {
  JupyterClientError,
  ConnectionError,
  UnauthorizedError,
  KernelNotFoundError,
  NotebookNotFoundError,
  createErrorFromResponse,
} from './errors.js';

const DEFAULT_BASE_URL = 'http://localhost:8888';
const DEFAULT_TIMEOUT = 30000;

export class JupyterClient {
  private baseUrl: string;
  private token: string;
  private axios: AxiosInstance;

  constructor(config?: JupyterClientConfig) {
    this.baseUrl = config?.baseUrl ?? process.env.JUPYTER_SERVER_URL ?? DEFAULT_BASE_URL;
    this.token = config?.token ?? process.env.JUPYTER_TOKEN ?? '';
    const timeout = config?.timeout ?? DEFAULT_TIMEOUT;

    if (!this.token) {
      console.warn('[jupyter-client] JUPYTER_TOKEN が設定されていません');
    }

    this.axios = axios.create({
      baseURL: this.baseUrl,
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
    const response = await this.request<ApiResponse<Kernel>>(
      'GET',
      `/api/kernels/${kernelId}`,
      undefined,
      { kernelId }
    );
    return response.data;
  }

  async deleteKernel(kernelId: string): Promise<DeleteKernelResponse> {
    const response = await this.request<ApiResponse<DeleteKernelResponse>>(
      'DELETE',
      `/api/kernels/${kernelId}`,
      undefined,
      { kernelId }
    );
    return response.data;
  }

  async interruptKernel(kernelId: string): Promise<Kernel> {
    const response = await this.request<ApiResponse<Kernel>>(
      'POST',
      `/api/kernels/${kernelId}/interrupt`,
      undefined,
      { kernelId }
    );
    return response.data;
  }

  async restartKernel(kernelId: string): Promise<Kernel> {
    const response = await this.request<ApiResponse<Kernel>>(
      'POST',
      `/api/kernels/${kernelId}/restart`,
      undefined,
      { kernelId }
    );
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
    // パス正規化: 先頭の '/' の有無に対応
    const normalizedPath = notebookPath.replace(/^\//, '');
    return sessions.find(s => {
      const sessionPath = s.path.replace(/^\//, '');
      return sessionPath === normalizedPath;
    }) ?? null;
  }

  // 指定カーネルIDに関連するセッションを取得
  async getSessionByKernelId(kernelId: string): Promise<JupyterSession | null> {
    const sessions = await this.listSessions();
    return sessions.find(s => s.kernel.id === kernelId) ?? null;
  }

  // ===========================================================================
  // コード実行
  // ===========================================================================

  async executeCode(kernelId: string, request: ExecuteRequest): Promise<ExecuteResult> {
    // タイムアウト: リクエストのタイムアウト + 通信余裕時間（5秒）
    const requestTimeoutMs = request.timeout ? request.timeout * 1000 + 5000 : undefined;
    const response = await this.request<ApiResponse<ExecuteResult>>(
      'POST',
      `/api/kernels/${kernelId}/execute`,
      request,
      { kernelId },
      requestTimeoutMs
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
      { kernelId }
    );
    return response.data.variables;
  }

  async getVariable(kernelId: string, name: string): Promise<Variable | DataFrameVariable> {
    const response = await this.request<ApiResponse<Variable | DataFrameVariable>>(
      'GET',
      `/api/kernels/${kernelId}/variables/${encodeURIComponent(name)}`,
      undefined,
      { kernelId }
    );
    return response.data;
  }

  // ===========================================================================
  // ファイル・ノートブック管理
  // ===========================================================================

  async listContents(path = '/'): Promise<ContentsListResponse> {
    const queryString = path === '/' ? '' : `?path=${encodeURIComponent(path)}`;
    const response = await this.request<ApiResponse<ContentsListResponse>>(
      'GET',
      `/api/contents${queryString}`
    );
    return response.data;
  }

  async getContents(path: string): Promise<NotebookResponse> {
    const response = await this.request<ApiResponse<NotebookResponse>>(
      'GET',
      `/api/contents/${encodeURIComponent(path)}`,
      undefined,
      { path }
    );
    return response.data;
  }

  async createNotebook(path: string): Promise<CreateContentResponse> {
    const body: CreateContentRequest = {
      type: 'notebook',
      path,
    };
    const response = await this.request<ApiResponse<CreateContentResponse>>(
      'POST',
      '/api/contents',
      body
    );
    return response.data;
  }

  async updateNotebook(path: string, content: UpdateNotebookRequest): Promise<void> {
    await this.request<ApiResponse<unknown>>(
      'PUT',
      `/api/contents/${encodeURIComponent(path)}`,
      content,
      { path }
    );
  }

  async operateCell(path: string, operation: CellOperationRequest): Promise<void> {
    await this.request<ApiResponse<unknown>>(
      'PATCH',
      `/api/contents/${encodeURIComponent(path)}/cells`,
      operation,
      { path, index: operation.index }
    );
  }

  async deleteContents(path: string): Promise<void> {
    await this.request<ApiResponse<unknown>>(
      'DELETE',
      `/api/contents/${encodeURIComponent(path)}`,
      undefined,
      { path }
    );
  }

  // ===========================================================================
  // 内部メソッド
  // ===========================================================================

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    context?: { kernelId?: string; path?: string; index?: number },
    timeout?: number
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
    context?: { kernelId?: string; path?: string; index?: number }
  ): JupyterClientError {
    if (!(error instanceof AxiosError)) {
      // 予期しないエラー
      const errorMessage = error instanceof Error ? error.message : String(error);
      return new JupyterClientError(errorMessage, 'INTERNAL_ERROR', 500);
    }

    // 接続エラー
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return new ConnectionError(
        `jupyter-server (${this.baseUrl}) への接続に失敗しました: ${error.message}`
      );
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
        return createErrorFromResponse(
          statusCode,
          responseData.error.code,
          responseData.error.message,
          context
        );
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
      return new JupyterClientError(
        `HTTP エラー: ${statusCode}`,
        'HTTP_ERROR',
        statusCode
      );
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
