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

describe('DocumentServerClient', () => {
  let client: DocumentServerClient;
  let mockAxiosInstance: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DocumentServerClient();
    // axios.create が返すモックインスタンスを取得
    mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
  });

  describe('getTableIndex', () => {
    it('正常系: テーブルインデックスが取得できる', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            tables: [
              {
                table_name: 'purchase_history',
                display_name: '購買履歴',
                summary: '購買データ',
                category: 'トランザクション系',
              },
            ],
            total: 1,
          },
        },
      });

      const result = await client.getTableIndex();

      expect(result.tables).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.tables[0].table_name).toBe('purchase_history');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/catalog/index');
    });
  });

  describe('getTableDetails', () => {
    it('正常系: テーブル詳細が一括取得できる', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            tables: [
              {
                table_name: 'customer_master',
                display_name: '会員マスタ',
                description: '会員情報',
                data_source: { type: 'postgresql', table: 'customer_master' },
                columns: [
                  {
                    name: 'customer_id',
                    type: 'varchar(16)',
                    description: '統合会員ID',
                    nullable: false,
                  },
                ],
              },
            ],
            not_found: [],
          },
        },
      });

      const result = await client.getTableDetails(['customer_master']);

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].table_name).toBe('customer_master');
      expect(result.tables[0].columns).toHaveLength(1);
      expect(result.not_found).toHaveLength(0);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/catalog/tables', { table_names: ['customer_master'] });
    });

    it('正常系: not_foundがある場合も正しくパースされる', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            tables: [
              {
                table_name: 'customer_master',
                display_name: '会員マスタ',
                description: '会員情報',
                data_source: { type: 'postgresql', table: 'customer_master' },
                columns: [],
              },
            ],
            not_found: ['nonexistent_table'],
          },
        },
      });

      const result = await client.getTableDetails(['customer_master', 'nonexistent_table']);

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].table_name).toBe('customer_master');
      expect(result.not_found).toEqual(['nonexistent_table']);
    });

    it('異常系: ネットワークエラーで適切なエラーがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        response: undefined,
        request: {},
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(client.getTableDetails(['some_table'])).rejects.toThrow(DocumentClientError);

      try {
        await client.getTableDetails(['some_table']);
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('CONNECTION_ERROR');
        expect(clientError.statusCode).toBe(503);
      }
    });
  });
});
