import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック
const mockClient = {
  getTableIndex: vi.fn(),
  getTableDetails: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeTableDetail } from '../../../src/tools/table-detail.js';

describe('get_table_detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 単一テーブル指定で詳細が取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'purchase_history',
          display_name: '購買履歴',
          description: '統合会員の購買トランザクションデータ。',
          data_source: {
            type: 'postgresql',
            table: 'purchase_history',
          },
          columns: [
            {
              name: 'customer_id',
              type: 'varchar(16)',
              description: '統合会員ID',
              nullable: false,
              key_type: '統合会員番号',
              domain: {
                master_table: 'customer_master',
                master_column: 'customer_id',
                label_column: 'customer_name',
              },
              notes: '会員マスタとの結合にはこのカラムを使うこと。',
              examples: ['MB00010001', 'MB00010020'],
            },
            {
              name: 'amount',
              type: 'integer',
              description: '購買金額（税抜）',
              nullable: false,
            },
          ],
          statistics: {
            row_count: 15000000,
            date_range: { from: '2020-01-01', to: '2025-12-31' },
            update_frequency: '日次バッチ',
          },
          notes_table_level: ['キャンセル済み取引もレコードとして残っている。'],
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['purchase_history'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);
    expect(tables[0].table_name).toBe('purchase_history');
    expect(tables[0].display_name).toBe('購買履歴');
    expect(tables[0].data_source).toBeDefined();

    const columns = tables[0].columns as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(2);
    expect(columns[0].key_type).toBe('統合会員番号');
    expect(columns[0].domain).toBeDefined();

    expect(tables[0].statistics).toBeDefined();
    expect(tables[0].notes_table_level).toHaveLength(1);

    expect(parsed.not_found).toEqual([]);
  });

  it('正常系: 複数テーブル指定で一括取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'purchase_history',
          display_name: '購買履歴',
          description: '購買データ',
          data_source: { type: 'postgresql', table: 'purchase_history' },
          columns: [],
        },
        {
          table_name: 'customer_master',
          display_name: '会員マスタ',
          description: '会員情報',
          data_source: { type: 'postgresql', table: 'customer_master' },
          columns: [],
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({
      table_names: ['purchase_history', 'customer_master'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(2);
    expect(tables[0].table_name).toBe('purchase_history');
    expect(tables[1].table_name).toBe('customer_master');
    expect(parsed.not_found).toEqual([]);

    expect(mockClient.getTableDetails).toHaveBeenCalledWith(['purchase_history', 'customer_master']);
  });

  it('正常系: 一部テーブルが見つからない場合、tablesとnot_foundが両方返る', async () => {
    mockClient.getTableDetails.mockResolvedValue({
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
    });

    const result = await executeTableDetail({
      table_names: ['customer_master', 'nonexistent_table'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);
    expect(tables[0].table_name).toBe('customer_master');

    const notFound = parsed.not_found as string[];
    expect(notFound).toEqual(['nonexistent_table']);
  });

  it('正常系: オプションフィールドが省略されたテーブルも取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'simple_table',
          display_name: 'シンプルテーブル',
          description: 'シンプルなテーブル',
          data_source: {
            type: 'postgresql',
            table: 'simple_table',
          },
          columns: [
            {
              name: 'id',
              type: 'integer',
              description: 'ID',
              nullable: false,
            },
          ],
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['simple_table'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);
    expect(tables[0].table_name).toBe('simple_table');
    expect(tables[0].statistics).toBeUndefined();
    expect(tables[0].notes_table_level).toBeUndefined();
  });

  it('正常系: key_typesを持つカラムが正しく返却される', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'transaction_log',
          display_name: '取引ログ',
          description: '取引データ',
          data_source: { type: 'postgresql', table: 'transaction_log' },
          columns: [
            {
              name: 'partner_id',
              type: 'varchar(16)',
              description: '取引先ID',
              nullable: false,
              key_types: [
                { value: '仕入先コード', condition: "transaction_type = 'purchase'" },
                { value: '販売先コード', condition: "transaction_type = 'sales'" },
              ],
            },
          ],
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['transaction_log'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);

    const columns = tables[0].columns as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(1);
    expect(columns[0].key_type).toBeUndefined();

    const keyTypes = columns[0].key_types as Array<{ value: string; condition: string }>;
    expect(keyTypes).toHaveLength(2);
    expect(keyTypes[0]).toEqual({ value: '仕入先コード', condition: "transaction_type = 'purchase'" });
    expect(keyTypes[1]).toEqual({ value: '販売先コード', condition: "transaction_type = 'sales'" });
  });

  it('正常系: key_typeとkey_typesが異なるカラムで混在するレスポンスを返却できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'mixed_table',
          display_name: '混在テーブル',
          description: 'key_typeとkey_typesが混在',
          data_source: { type: 'postgresql', table: 'mixed_table' },
          columns: [
            {
              name: 'customer_id',
              type: 'varchar(16)',
              description: '会員ID',
              nullable: false,
              key_type: '統合会員番号',
            },
            {
              name: 'partner_id',
              type: 'varchar(16)',
              description: '取引先ID',
              nullable: false,
              key_types: [
                { value: '仕入先コード', condition: "type = 'A'" },
                { value: '販売先コード', condition: null },
              ],
            },
          ],
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['mixed_table'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    const columns = tables[0].columns as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(2);

    // key_type のみのカラム
    expect(columns[0].key_type).toBe('統合会員番号');
    expect(columns[0].key_types).toBeUndefined();

    // key_types のみのカラム
    expect(columns[1].key_type).toBeUndefined();
    const keyTypes = columns[1].key_types as Array<{ value: string; condition: string | null }>;
    expect(keyTypes).toHaveLength(2);
    expect(keyTypes[1].condition).toBeNull();
  });

  it('正常系: statistics.additional を含むテーブル詳細を取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'sales_summary',
          display_name: '売上サマリ',
          description: '売上集計データ',
          data_source: { type: 'postgresql', table: 'sales_summary' },
          columns: [
            {
              name: 'id',
              type: 'integer',
              description: 'ID',
              nullable: false,
            },
          ],
          statistics: {
            row_count: 5000,
            update_frequency: '月次',
            additional: {
              avg_amount: 12500,
              top_category: '食品',
            },
          },
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['sales_summary'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    expect(tables).toHaveLength(1);

    const statistics = tables[0].statistics as Record<string, unknown>;
    expect(statistics.row_count).toBe(5000);
    expect(statistics.update_frequency).toBe('月次');

    const additional = statistics.additional as Record<string, unknown>;
    expect(additional.avg_amount).toBe(12500);
    expect(additional.top_category).toBe('食品');
  });

  it('正常系: statistics.additional が空オブジェクトのテーブルも取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'empty_additional',
          display_name: '空additional',
          description: 'additionalが空',
          data_source: { type: 'postgresql', table: 'empty_additional' },
          columns: [],
          statistics: {
            row_count: 100,
            additional: {},
          },
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['empty_additional'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    const statistics = tables[0].statistics as Record<string, unknown>;
    expect(statistics.row_count).toBe(100);
    expect(statistics.additional).toEqual({});
  });

  it('正常系: statistics.additional に多様な値型を含むテーブルを取得できる', async () => {
    mockClient.getTableDetails.mockResolvedValue({
      tables: [
        {
          table_name: 'diverse_stats',
          display_name: '多様統計',
          description: '多様な値型のadditional',
          data_source: { type: 'postgresql', table: 'diverse_stats' },
          columns: [],
          statistics: {
            row_count: 3000,
            additional: {
              avg_score: 85.5,
              label: '高スコア',
              top_items: ['商品A', '商品B', '商品C'],
              breakdown: { category_a: 1200, category_b: 1800 },
            },
          },
        },
      ],
      not_found: [],
    });

    const result = await executeTableDetail({ table_names: ['diverse_stats'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const tables = parsed.tables as Array<Record<string, unknown>>;
    const statistics = tables[0].statistics as Record<string, unknown>;
    const additional = statistics.additional as Record<string, unknown>;

    expect(additional.avg_score).toBe(85.5);
    expect(additional.label).toBe('高スコア');
    expect(additional.top_items).toEqual(['商品A', '商品B', '商品C']);
    expect(additional.breakdown).toEqual({ category_a: 1200, category_b: 1800 });
  });

  it('異常系: table_names未指定でVALIDATION_ERRORが返る', async () => {
    const result = await executeTableDetail({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('table_names');
  });

  it('異常系: table_namesが空配列でVALIDATION_ERRORが返る', async () => {
    const result = await executeTableDetail({ table_names: [] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('table_names');
  });

  it('異常系: table_namesが文字列（配列でない）でVALIDATION_ERRORが返る', async () => {
    const result = await executeTableDetail({ table_names: 'single_string' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('table_names');
  });

  it('異常系: API接続エラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getTableDetails.mockRejectedValue(error);

    const result = await executeTableDetail({ table_names: ['some_table'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
  });
});
