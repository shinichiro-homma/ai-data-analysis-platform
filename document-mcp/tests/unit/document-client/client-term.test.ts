import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { DocumentServerClient, DocumentClientError } from '../../../src/document-client/client.js';

// axios をモック
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
      isAxiosError: vi.fn((error: unknown) => {
        return typeof error === 'object' && error !== null && 'isAxiosError' in error;
      }),
    },
  };
});

describe('DocumentServerClient - Term methods', () => {
  let client: DocumentServerClient;
  let mockAxiosInstance: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DocumentServerClient();
    // axios.create が返すモックインスタンスを取得
    mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
  });

  describe('getTermIndex', () => {
    it('正常系: 用語インデックスが取得できる', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            terms: [
              {
                name: '統合会員番号',
                summary: '複数チャネルの顧客情報を統合した一意の識別番号',
              },
              {
                name: '洗い替え',
                summary: '会員統合時にIDを最新の統合キーに置換する処理',
              },
            ],
            total: 2,
          },
        },
      });

      const result = await client.getTermIndex();

      expect(result.terms).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.terms[0].name).toBe('統合会員番号');
      expect(result.terms[1].name).toBe('洗い替え');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/glossary/index', {
        params: undefined,
      });
    });

    it('正常系: query パラメータが GET クエリとして送信される', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            terms: [{ name: 'ポイントキャンペーン', summary: 'ポイント付与キャンペーン' }],
            total: 1,
          },
        },
      });

      const result = await client.getTermIndex('PC');

      expect(result.total).toBe(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/glossary/index', {
        params: { query: 'PC' },
      });
    });

    it('正常系: query 省略時はクエリパラメータなしで送信される', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            terms: [{ name: '用語A', summary: '概要A' }],
            total: 1,
          },
        },
      });

      const result = await client.getTermIndex();

      expect(result.total).toBe(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/glossary/index', {
        params: undefined,
      });
    });

    it('異常系: サーバーエラーでDocumentClientErrorがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        response: undefined,
        request: {},
      };
      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(client.getTermIndex()).rejects.toThrow(DocumentClientError);

      try {
        await client.getTermIndex();
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('CONNECTION_ERROR');
        expect(clientError.statusCode).toBe(503);
      }
    });
  });

  describe('getTermDetails', () => {
    it('正常系: 用語詳細が一括取得できる', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            terms: [
              {
                name: '統合会員番号',
                aliases: ['統合ID', '統合顧客ID'],
                definition: '複数チャネルの顧客情報を統合した一意の識別番号',
                related_terms: ['洗い替え'],
                values: [
                  {
                    label: 'MB + 8桁数字',
                    description: '統合会員番号の形式',
                  },
                ],
              },
            ],
            not_found: [],
          },
        },
      });

      const result = await client.getTermDetails(['統合会員番号']);

      expect(result.terms).toHaveLength(1);
      expect(result.terms[0].name).toBe('統合会員番号');
      expect(result.terms[0].aliases).toEqual(['統合ID', '統合顧客ID']);
      expect(result.terms[0].definition).toContain('統合した一意の識別番号');
      expect(result.not_found).toHaveLength(0);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/glossary/terms', { term_names: ['統合会員番号'] });
    });

    it('異常系: サーバーエラーでDocumentClientErrorがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        response: undefined,
        request: {},
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(client.getTermDetails(['some_term'])).rejects.toThrow(DocumentClientError);

      try {
        await client.getTermDetails(['some_term']);
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('CONNECTION_ERROR');
        expect(clientError.statusCode).toBe(503);
      }
    });
  });
});
