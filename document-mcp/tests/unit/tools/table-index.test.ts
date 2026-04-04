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

import { executeTableIndex } from '../../../src/tools/table-index.js';

describe('get_table_index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: テーブルが複数存在する場合、tables配列とtotalが正しく返る', async () => {
    mockClient.getTableIndex.mockResolvedValue({
      tables: [
        {
          table_name: 'purchase_history',
          display_name: '購買履歴',
          summary: '統合会員の購買トランザクションデータ',
          category: 'トランザクション系',
        },
        {
          table_name: 'customer_master',
          display_name: '会員マスタ',
          summary: '統合会員の基本情報を管理するマスタテーブル',
          category: 'マスタ系',
        },
      ],
      total: 2,
    });

    const result = await executeTableIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(2);
    expect(parsed.tables).toHaveLength(2);

    const tables = parsed.tables as Array<{ table_name: string; display_name: string }>;
    expect(tables[0].table_name).toBe('purchase_history');
    expect(tables[1].table_name).toBe('customer_master');
  });

  it('正常系: テーブルが0件の場合、空配列とtotal: 0が返る', async () => {
    mockClient.getTableIndex.mockResolvedValue({
      tables: [],
      total: 0,
    });

    const result = await executeTableIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(0);
    expect(parsed.tables).toHaveLength(0);
  });

  it('異常系: API接続エラー時にsuccess: falseとエラーメッセージが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getTableIndex.mockRejectedValue(error);

    const result = await executeTableIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.message).toContain('接続できません');
  });
});
