/**
 * document-server REST API クライアント
 */

import axios, { type AxiosInstance } from 'axios';
import { McpBaseError } from '@ai-data-analysis/mcp-shared';
import { logger } from '../utils/logger.js';
import type {
  ApiResponse,
  TableIndex,
  TableIndexResponse,
  TableDetailResponse,
  TermIndexResponse,
  TermDetailResponse,
  LogicIndexResponse,
  LogicMetaResponse,
  LogicCode,
  LogicCodeResponse,
  ErrorResponse,
} from './types.js';

/**
 * document-server API クライアントエラー
 */
export class DocumentClientError extends McpBaseError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'DocumentClientError';
  }
}

/**
 * document-server REST API クライアント
 */
export class DocumentServerClient {
  private httpClient: AxiosInstance;

  constructor() {
    const baseURL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';

    let parsed: URL;
    try {
      parsed = new URL(baseURL);
    } catch {
      throw new Error('Invalid DOCUMENT_SERVER_URL: URL の形式が不正です');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid DOCUMENT_SERVER_URL: サポートされないプロトコル ${parsed.protocol}`);
    }

    this.httpClient = axios.create({
      baseURL,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    logger.info('DocumentServerClient initialized');
  }

  /**
   * API リクエストの共通処理
   */
  private async request<T>(fn: () => Promise<{ data: ApiResponse<T> }>): Promise<T> {
    try {
      const response = await fn();
      return response.data.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * テーブルインデックスを取得
   */
  async getTableIndex(): Promise<{ tables: TableIndex[]; total: number }> {
    return this.request(() => this.httpClient.get<TableIndexResponse>('/catalog/index'));
  }

  /**
   * テーブル詳細を一括取得
   */
  async getTableDetails(tableNames: string[]): Promise<TableDetailResponse['data']> {
    return this.request(() =>
      this.httpClient.post<TableDetailResponse>('/catalog/tables', { table_names: tableNames }),
    );
  }

  /**
   * 用語インデックスを取得
   */
  async getTermIndex(query?: string): Promise<TermIndexResponse['data']> {
    return this.request(() =>
      this.httpClient.get<TermIndexResponse>('/glossary/index', {
        params: query ? { query } : undefined,
      }),
    );
  }

  /**
   * 用語詳細を一括取得
   */
  async getTermDetails(termNames: string[]): Promise<TermDetailResponse['data']> {
    return this.request(() => this.httpClient.post<TermDetailResponse>('/glossary/terms', { term_names: termNames }));
  }

  /**
   * ロジックインデックスを取得
   */
  async getLogicIndex(): Promise<LogicIndexResponse['data']> {
    return this.request(() => this.httpClient.get<LogicIndexResponse>('/logic/index'));
  }

  /**
   * ロジックメタ情報を一括取得
   */
  async getLogicMetas(logicNames: string[]): Promise<LogicMetaResponse['data']> {
    return this.request(() => this.httpClient.post<LogicMetaResponse>('/logic/meta', { logic_names: logicNames }));
  }

  /**
   * ロジックコードを取得
   */
  async getLogicCode(logicName: string): Promise<LogicCode> {
    return this.request(() => this.httpClient.get<LogicCodeResponse>(`/logic/code/${encodeURIComponent(logicName)}`));
  }

  /**
   * エラーレスポンスの型ガード
   */
  private isErrorResponseData(data: unknown): data is ErrorResponse {
    if (typeof data !== 'object' || data === null || !('error' in data)) {
      return false;
    }
    const errorObj = (data as { error: unknown }).error;
    if (typeof errorObj !== 'object' || errorObj === null) {
      return false;
    }
    const { code, message } = errorObj as Record<string, unknown>;
    return typeof code === 'string' && typeof message === 'string';
  }

  /**
   * axios エラーを DocumentClientError に変換
   */
  private handleError(error: unknown): DocumentClientError {
    if (axios.isAxiosError(error)) {
      // HTTP レスポンスエラー
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        let code = `HTTP_${status}`;
        let message = `HTTP ${status} error`;

        if (this.isErrorResponseData(data)) {
          code = data.error.code;
          message = data.error.message;
        }

        logger.error(`document-server HTTP ${status}:`, code);
        return new DocumentClientError(message, code, status);
      }

      // タイムアウト
      if (error.code === 'ECONNABORTED') {
        logger.error('document-server timeout');
        return new DocumentClientError('document-server への接続がタイムアウトしました。', 'TIMEOUT_ERROR', 408);
      }

      // ネットワークエラー（接続拒否、DNS解決失敗、接続リセット等）
      if (!error.response && error.request) {
        logger.error('document-server connection error:', error.code);
        return new DocumentClientError(
          'document-server に接続できません。サーバーが起動しているか確認してください。',
          'CONNECTION_ERROR',
          503,
        );
      }
    }

    // その他のエラー
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Unexpected error:', message);
    return new DocumentClientError(message, 'INTERNAL_ERROR', 500);
  }
}

/**
 * シングルトンインスタンス（遅延初期化）
 */
let _instance: DocumentServerClient | null = null;

export function getDocumentClient(): DocumentServerClient {
  if (!_instance) {
    _instance = new DocumentServerClient();
  }
  return _instance;
}
