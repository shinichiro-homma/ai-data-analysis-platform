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

import { executeTermDetail } from '../../../src/tools/term-detail.js';

describe('get_term_detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: 単一用語の詳細が取得できる（全フィールドあり）', async () => {
    mockClient.getTermDetails.mockResolvedValue({
      terms: [
        {
          name: '統合会員番号',
          aliases: ['統合ID', '統合顧客ID'],
          definition: '複数チャネルの顧客情報を統合した一意の識別番号。洗い替え処理により最新の統合キーに更新される。',
          related_terms: ['洗い替え', '会員マスタ'],
          values: [
            {
              label: 'MB + 8桁数字',
              description: '統合会員番号の形式。例: MB00012345',
            },
          ],
        },
      ],
      not_found: [],
    });

    const result = await executeTermDetail({ term_names: ['統合会員番号'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const terms = parsed.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(1);
    expect(terms[0].name).toBe('統合会員番号');
    expect(terms[0].aliases).toEqual(['統合ID', '統合顧客ID']);
    expect(terms[0].definition).toContain('統合した一意の識別番号');
    expect(terms[0].related_terms).toEqual(['洗い替え', '会員マスタ']);

    const values = terms[0].values as Array<{ label: string; description: string }>;
    expect(values).toHaveLength(1);
    expect(values[0].label).toBe('MB + 8桁数字');

    expect(parsed.not_found).toEqual([]);
  });

  it('正常系: 複数用語の一括取得ができる', async () => {
    mockClient.getTermDetails.mockResolvedValue({
      terms: [
        {
          name: '統合会員番号',
          aliases: ['統合ID'],
          definition: '統合した一意の識別番号',
        },
        {
          name: '洗い替え',
          aliases: [],
          definition: '会員統合時にIDを最新の統合キーに置換する処理',
        },
      ],
      not_found: [],
    });

    const result = await executeTermDetail({
      term_names: ['統合会員番号', '洗い替え'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const terms = parsed.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(2);
    expect(terms[0].name).toBe('統合会員番号');
    expect(terms[1].name).toBe('洗い替え');
    expect(parsed.not_found).toEqual([]);

    expect(mockClient.getTermDetails).toHaveBeenCalledWith(['統合会員番号', '洗い替え']);
  });

  it('正常系: optionalフィールドなしの場合', async () => {
    mockClient.getTermDetails.mockResolvedValue({
      terms: [
        {
          name: '洗い替え',
          aliases: [],
          definition: '会員統合時にIDを最新の統合キーに置換する処理',
        },
      ],
      not_found: [],
    });

    const result = await executeTermDetail({ term_names: ['洗い替え'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const terms = parsed.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(1);
    expect(terms[0].name).toBe('洗い替え');
    expect(terms[0].related_terms).toBeUndefined();
    expect(terms[0].values).toBeUndefined();
  });

  it('正常系: 一部見つからない場合にnot_foundが返る', async () => {
    mockClient.getTermDetails.mockResolvedValue({
      terms: [
        {
          name: '統合会員番号',
          aliases: ['統合ID'],
          definition: '統合した一意の識別番号',
        },
      ],
      not_found: ['存在しない用語'],
    });

    const result = await executeTermDetail({
      term_names: ['統合会員番号', '存在しない用語'],
    });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);

    const terms = parsed.terms as Array<Record<string, unknown>>;
    expect(terms).toHaveLength(1);
    expect(terms[0].name).toBe('統合会員番号');

    const notFound = parsed.not_found as string[];
    expect(notFound).toEqual(['存在しない用語']);
  });

  it('異常系: term_names未指定でVALIDATION_ERRORが返る', async () => {
    const result = await executeTermDetail({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('term_names');
  });

  it('異常系: term_namesが空配列でVALIDATION_ERRORが返る', async () => {
    const result = await executeTermDetail({ term_names: [] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('term_names');
  });

  it('異常系: term_namesが文字列（配列でない）でVALIDATION_ERRORが返る', async () => {
    const result = await executeTermDetail({ term_names: 'single_string' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('term_names');
  });

  it('異常系: サーバーエラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getTermDetails.mockRejectedValue(error);

    const result = await executeTermDetail({ term_names: ['some_term'] });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
  });
});
