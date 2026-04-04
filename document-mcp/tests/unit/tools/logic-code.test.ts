import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseToolCallResult } from '../../setup.js';

// getDocumentClient をモック
const mockClient = {
  getLogicCode: vi.fn(),
};
vi.mock('../../../src/document-client/client.js', () => ({
  getDocumentClient: () => mockClient,
}));

import { executeLogicCode } from '../../../src/tools/logic-code.js';

describe('get_logic_code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('正常系: ロジックのコードが取得できる', async () => {
    mockClient.getLogicCode.mockResolvedValue({
      logic_name: 'member_id_remapping',
      language: 'sql',
      code: 'SELECT COALESCE(m.new_member_id, t.customer_id) AS customer_id\nFROM purchase_history t\nLEFT JOIN member_id_mapping m\n  ON t.customer_id = m.old_member_id',
    });

    const result = await executeLogicCode({ logic_name: 'member_id_remapping' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(true);
    expect(parsed.logic_name).toBe('member_id_remapping');
    expect(parsed.language).toBe('sql');
    expect(parsed.code).toContain('SELECT COALESCE');
    expect(parsed.code).toContain('member_id_mapping');
  });

  it('異常系: logic_name未指定でVALIDATION_ERRORが返る', async () => {
    const result = await executeLogicCode({});
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('logic_name');
  });

  it('異常系: logic_nameが文字列でない場合にVALIDATION_ERRORが返る', async () => {
    const result = await executeLogicCode({ logic_name: 123 });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toContain('logic_name');
  });

  it('異常系: LOGIC_NOT_FOUNDエラーが伝播される', async () => {
    const error = new Error("ロジック 'nonexistent' が見つかりません");
    Object.assign(error, { code: 'LOGIC_NOT_FOUND' });
    mockClient.getLogicCode.mockRejectedValue(error);

    const result = await executeLogicCode({ logic_name: 'nonexistent' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('LOGIC_NOT_FOUND');
    expect(err.message).toContain('見つかりません');
  });

  it('異常系: LOGIC_CODE_NOT_FOUNDエラーが伝播される', async () => {
    const error = new Error("ロジック 'some_logic' のコードファイルが見つかりません");
    Object.assign(error, { code: 'LOGIC_CODE_NOT_FOUND' });
    mockClient.getLogicCode.mockRejectedValue(error);

    const result = await executeLogicCode({ logic_name: 'some_logic' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('LOGIC_CODE_NOT_FOUND');
    expect(err.message).toContain('コードファイルが見つかりません');
  });

  it('異常系: サーバーエラー時にエラーレスポンスが返る', async () => {
    const error = new Error('document-server に接続できません。サーバーが起動しているか確認してください。');
    Object.assign(error, { code: 'CONNECTION_ERROR' });
    mockClient.getLogicCode.mockRejectedValue(error);

    const result = await executeLogicCode({ logic_name: 'some_logic' });
    const parsed = parseToolCallResult(result);

    expect(parsed.success).toBe(false);

    const err = parsed.error as { code: string; message: string };
    expect(err.code).toBe('CONNECTION_ERROR');
  });
});
