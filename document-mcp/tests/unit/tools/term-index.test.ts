import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック
const mockClient = {
  getTermIndex: vi.fn(),
  getTermDetails: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeTermIndex } from '../../../src/tools/term-index.js';

describe('get_term_index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 全用語のインデックスが取得できる', async () => {
    mockClient.getTermIndex.mockResolvedValue({
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
    });

    const result = await executeTermIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(2);
    expect(parsed.terms).toHaveLength(2);

    const terms = parsed.terms as Array<{ name: string; summary: string }>;
    expect(terms[0].name).toBe('統合会員番号');
    expect(terms[1].name).toBe('洗い替え');
  });

  it('正常系: query ありでクライアントに query が渡される', async () => {
    mockClient.getTermIndex.mockResolvedValue({
      terms: [
        {
          name: 'ポイントキャンペーン',
          summary: 'ポイント付与キャンペーン',
        },
      ],
      total: 1,
    });

    const result = await executeTermIndex({ query: 'PC' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(1);
    expect(parsed.terms).toHaveLength(1);
    expect(mockClient.getTermIndex).toHaveBeenCalledWith('PC');
  });

  it('正常系: query なしでクライアントに undefined が渡される', async () => {
    mockClient.getTermIndex.mockResolvedValue({
      terms: [
        { name: '用語A', summary: '概要A' },
        { name: '用語B', summary: '概要B' },
      ],
      total: 2,
    });

    const result = await executeTermIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBe(2);
    expect(mockClient.getTermIndex).toHaveBeenCalledWith(undefined);
  });

  it('異常系: サーバーエラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getTermIndex.mockRejectedValue(error);

    const result = await executeTermIndex({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
    expect(err.message).toContain('接続できません');
  });
});
