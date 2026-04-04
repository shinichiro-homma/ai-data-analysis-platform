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

describe('DocumentServerClient - Logic methods', () => {
  let client: DocumentServerClient;
  let mockAxiosInstance: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new DocumentServerClient();
    // axios.create が返すモックインスタンスを取得
    mockAxiosInstance = (axios.create as ReturnType<typeof vi.fn>).mock.results[0].value;
  });

  describe('getLogicIndex', () => {
    it('正常系: ロジックインデックスが取得できる', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            logic: [
              {
                logic_name: 'member_id_remapping',
                summary: '統合会員IDの洗い替え処理',
                category: '前処理',
              },
              {
                logic_name: 'sales_basic_aggregation',
                summary: '売上基礎集計',
                category: '集計',
              },
            ],
            total: 2,
          },
        },
      });

      const result = await client.getLogicIndex();

      expect(result.logic).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.logic[0].logic_name).toBe('member_id_remapping');
      expect(result.logic[1].logic_name).toBe('sales_basic_aggregation');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/logic/index');
    });

    it('異常系: サーバーエラーでDocumentClientErrorがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        response: undefined,
        request: {},
      };
      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(client.getLogicIndex()).rejects.toThrow(DocumentClientError);

      try {
        await client.getLogicIndex();
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('CONNECTION_ERROR');
        expect(clientError.statusCode).toBe(503);
      }
    });
  });

  describe('getLogicMetas', () => {
    it('正常系: ロジックメタ情報が一括取得できる', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: {
          data: {
            logic: [
              {
                logic_name: 'member_id_remapping',
                description: '統合会員IDの洗い替え処理',
                file_path: 'logic/sql/member_id_remapping.sql',
                language: 'sql',
                usage_type: 'template',
                input_tables: ['purchase_history', 'member_id_mapping'],
                output_description: '洗い替え後のデータ',
                usage_context: '前処理として適用',
                related_logic: [],
                notes: '',
              },
            ],
            not_found: [],
          },
        },
      });

      const result = await client.getLogicMetas(['member_id_remapping']);

      expect(result.logic).toHaveLength(1);
      expect(result.logic[0].logic_name).toBe('member_id_remapping');
      expect(result.logic[0].language).toBe('sql');
      expect(result.logic[0].usage_type).toBe('template');
      expect(result.not_found).toHaveLength(0);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/logic/meta', { logic_names: ['member_id_remapping'] });
    });

    it('異常系: サーバーエラーでDocumentClientErrorがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        code: 'ECONNREFUSED',
        response: undefined,
        request: {},
      };
      mockAxiosInstance.post.mockRejectedValue(axiosError);

      await expect(client.getLogicMetas(['some_logic'])).rejects.toThrow(DocumentClientError);

      try {
        await client.getLogicMetas(['some_logic']);
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('CONNECTION_ERROR');
        expect(clientError.statusCode).toBe(503);
      }
    });
  });

  describe('getLogicCode', () => {
    it('正常系: ロジックコードが取得できる', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          data: {
            logic_name: 'member_id_remapping',
            language: 'sql',
            code: 'SELECT * FROM purchase_history',
          },
        },
      });

      const result = await client.getLogicCode('member_id_remapping');

      expect(result.logic_name).toBe('member_id_remapping');
      expect(result.language).toBe('sql');
      expect(result.code).toBe('SELECT * FROM purchase_history');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/logic/code/member_id_remapping');
    });

    it('異常系: HTTPエラーでDocumentClientErrorがthrowされる', async () => {
      const axiosError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            error: {
              code: 'LOGIC_NOT_FOUND',
              message: "ロジック 'nonexistent' が見つかりません",
            },
          },
        },
      };
      mockAxiosInstance.get.mockRejectedValue(axiosError);

      await expect(client.getLogicCode('nonexistent')).rejects.toThrow(DocumentClientError);

      try {
        await client.getLogicCode('nonexistent');
      } catch (error) {
        expect(error).toBeInstanceOf(DocumentClientError);
        const clientError = error as DocumentClientError;
        expect(clientError.code).toBe('LOGIC_NOT_FOUND');
        expect(clientError.statusCode).toBe(404);
      }
    });
  });
});
