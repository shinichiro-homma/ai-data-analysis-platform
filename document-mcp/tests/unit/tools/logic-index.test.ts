import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック
const mockClient = {
  getLogicIndex: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeLogicIndex } from '../../../src/tools/logic-index.js';

describe('get_logic_index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 全ロジックのインデックスが取得できる', async () => {
    mockClient.getLogicIndex.mockResolvedValue({
      logic: [
        {
          logic_name: 'member_id_remapping',
          summary: '統合会員IDの洗い替え処理。洗い替え前IDを最新IDに変換する。',
          category: '前処理',
        },
        {
          logic_name: 'sales_basic_aggregation',
          summary: '店舗別・顧客セグメント別の売上基礎集計',
          category: '集計',
        },
      ],
      total: 2,
    });

    const result = await executeLogicIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(2);
    expect(parsed.logic).toHaveLength(2);

    const logic = parsed.logic as Array<{ logic_name: string; summary: string; category: string }>;
    expect(logic[0].logic_name).toBe('member_id_remapping');
    expect(logic[0].category).toBe('前処理');
    expect(logic[1].logic_name).toBe('sales_basic_aggregation');
    expect(logic[1].category).toBe('集計');
  });

  it('異常系: サーバーエラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getLogicIndex.mockRejectedValue(error);

    const result = await executeLogicIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.message).toContain('接続できません');
  });
});
