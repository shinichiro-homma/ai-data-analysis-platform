import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック
const mockClient = {
  getLogicMetas: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeLogicDetail } from '../../../src/tools/logic-detail.js';

describe('get_logic_detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 単一ロジックのメタ情報が取得できる', async () => {
    mockClient.getLogicMetas.mockResolvedValue({
      logic: [
        {
          logic_name: 'member_id_remapping',
          description: '統合会員IDの洗い替え処理。旧IDを最新のIDに変換する前処理。',
          file_path: 'logic/sql/member_id_remapping.sql',
          language: 'sql',
          usage_type: 'template',
          input_tables: ['purchase_history', 'member_id_mapping'],
          output_description: '洗い替え後のcustomer_idを持つトランザクションデータ',
          usage_context: '購買データを使った分析の前処理として適用する。',
          related_logic: ['sales_basic_aggregation'],
          notes: '洗い替えマッピングテーブルは月次で更新される。',
        },
      ],
      not_found: [],
    });

    const result = await executeLogicDetail({ logic_names: ['member_id_remapping'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const logic = parsed.logic as Array<Record<string, unknown>>;
    expect(logic).toHaveLength(1);
    expect(logic[0].logic_name).toBe('member_id_remapping');
    expect(logic[0].language).toBe('sql');
    expect(logic[0].usage_type).toBe('template');
    expect(logic[0].input_tables).toEqual(['purchase_history', 'member_id_mapping']);
    expect(logic[0].related_logic).toEqual(['sales_basic_aggregation']);

    expect(parsed.not_found).toEqual([]);
  });

  it('正常系: 複数ロジックの一括取得ができる', async () => {
    mockClient.getLogicMetas.mockResolvedValue({
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
        {
          logic_name: 'sales_basic_aggregation',
          description: '売上基礎集計',
          file_path: 'logic/sql/sales_basic_aggregation.sql',
          language: 'sql',
          usage_type: 'reference',
          input_tables: ['purchase_history'],
          output_description: '集計結果',
          usage_context: '売上分析で使用',
          related_logic: ['member_id_remapping'],
          notes: '',
        },
      ],
      not_found: [],
    });

    const result = await executeLogicDetail({
      logic_names: ['member_id_remapping', 'sales_basic_aggregation'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const logic = parsed.logic as Array<Record<string, unknown>>;
    expect(logic).toHaveLength(2);
    expect(logic[0].logic_name).toBe('member_id_remapping');
    expect(logic[1].logic_name).toBe('sales_basic_aggregation');
    expect(parsed.not_found).toEqual([]);

    expect(mockClient.getLogicMetas).toHaveBeenCalledWith(['member_id_remapping', 'sales_basic_aggregation']);
  });

  it('正常系: 一部見つからない場合にnot_foundが返る', async () => {
    mockClient.getLogicMetas.mockResolvedValue({
      logic: [
        {
          logic_name: 'member_id_remapping',
          description: '統合会員IDの洗い替え処理',
          file_path: 'logic/sql/member_id_remapping.sql',
          language: 'sql',
          usage_type: 'template',
          input_tables: [],
          output_description: '',
          usage_context: '',
          related_logic: [],
          notes: '',
        },
      ],
      not_found: ['nonexistent_logic'],
    });

    const result = await executeLogicDetail({
      logic_names: ['member_id_remapping', 'nonexistent_logic'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const logic = parsed.logic as Array<Record<string, unknown>>;
    expect(logic).toHaveLength(1);
    expect(logic[0].logic_name).toBe('member_id_remapping');

    const notFound = parsed.not_found as string[];
    expect(notFound).toEqual(['nonexistent_logic']);
  });

  it('異常系: logic_names未指定でVALIDATION_ERRORが返る', async () => {
    const result = await executeLogicDetail({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('logic_names');
  });

  it('異常系: logic_namesが空配列でVALIDATION_ERRORが返る', async () => {
    const result = await executeLogicDetail({ logic_names: [] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('logic_names');
  });

  it('異常系: logic_namesが文字列（配列でない）でVALIDATION_ERRORが返る', async () => {
    const result = await executeLogicDetail({ logic_names: 'single_string' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('logic_names');
  });

  it('異常系: サーバーエラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getLogicMetas.mockRejectedValue(error);

    const result = await executeLogicDetail({ logic_names: ['some_logic'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
  });
});
