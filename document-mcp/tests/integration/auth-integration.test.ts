/**
 * REST API 認証の結合テスト
 *
 * 7.1（document-server への Bearer トークン認証）と
 * 7.2（document-mcp 側のトークン付与）の結合動作を検証する。
 *
 * テストの前提:
 * - document-server が起動していること（DOCUMENT_SERVER_URL）
 * - DOCUMENT_SERVER_TOKEN が設定されていること
 * - document-server/data/ にサンプル YAML が配置されていること
 */

import axios from 'axios';
import { handleToolCall } from '../../src/tools/index.js';
import { type ToolCallResponse, parseToolCallResult } from '../setup.js';
import { DocumentServerClient, DocumentClientError } from '../../src/document-client/client.js';
import { getFixture, type EnvFixture } from './fixtures/index.js';

const fixture: EnvFixture = getFixture();

/**
 * MCP ツールを呼び出し、結果をパースして返す
 */
async function callTool(toolName: string, args: Record<string, unknown> = {}): Promise<ToolCallResponse> {
  const result = await handleToolCall(toolName, args);
  return parseToolCallResult(result);
}

// ========================================
// 1. 認証成功時（正常系）
// ========================================

describe('認証成功時', () => {
  it('get_table_index が success: true を返す', async () => {
    const parsed = await callTool('get_table_index');
    expect(parsed.success).toBe(true);
    expect(parsed.tables).toBeInstanceOf(Array);
  });

  it('get_table_detail が success: true を返す', async () => {
    const { tableName } = fixture.tables.detail;
    const parsed = await callTool('get_table_detail', {
      table_names: [tableName],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.tables).toBeInstanceOf(Array);
  });

  it('get_term_index が success: true を返す', async () => {
    const parsed = await callTool('get_term_index');
    expect(parsed.success).toBe(true);
    expect(parsed.terms).toBeInstanceOf(Array);
  });

  it('get_term_detail が success: true を返す', async () => {
    const { termName } = fixture.terms.detail;
    const parsed = await callTool('get_term_detail', {
      term_names: [termName],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.terms).toBeInstanceOf(Array);
  });

  it('get_logic_index が success: true を返す', async () => {
    const parsed = await callTool('get_logic_index');
    expect(parsed.success).toBe(true);
    expect(parsed.logic).toBeInstanceOf(Array);
  });

  it('get_logic_detail が success: true を返す', async () => {
    const { logicName } = fixture.logic.detail;
    const parsed = await callTool('get_logic_detail', {
      logic_names: [logicName],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.logic).toBeInstanceOf(Array);
  });

  it('get_logic_code が success: true を返し Python コードが含まれる', async () => {
    const { logicName, codeContains } = fixture.logic.detail;
    const parsed = await callTool('get_logic_code', {
      logic_name: logicName,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.code).toBeDefined();
    expect(parsed.code as string).toContain(codeContains);
  });
});

// ========================================
// 2. 認証失敗時（異常系）
// ========================================

describe('認証失敗時', () => {
  // 環境変数を退避・復元するためのスナップショット
  let savedToken: string | undefined;

  beforeEach(() => {
    savedToken = process.env.DOCUMENT_SERVER_TOKEN;
  });

  afterEach(() => {
    // 環境変数を元の値に必ず復元する
    if (savedToken !== undefined) {
      process.env.DOCUMENT_SERVER_TOKEN = savedToken;
    } else {
      delete process.env.DOCUMENT_SERVER_TOKEN;
    }
  });

  it('誤ったトークンで DocumentServerClient を生成すると getTableIndex が 401 エラーを投げる', async () => {
    process.env.DOCUMENT_SERVER_TOKEN = 'wrong-invalid-token';
    const client = new DocumentServerClient();

    await expect(client.getTableIndex()).rejects.toThrow(DocumentClientError);

    try {
      await client.getTableIndex();
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentClientError);
      const clientError = error as DocumentClientError;
      expect(clientError.statusCode).toBe(401);
    }
  });

  it('空トークンで DocumentServerClient のコンストラクタが Error を投げる', () => {
    process.env.DOCUMENT_SERVER_TOKEN = '';

    expect(() => new DocumentServerClient()).toThrow(Error);
    expect(() => new DocumentServerClient()).toThrow('DOCUMENT_SERVER_TOKEN 環境変数が設定されていません');
  });

  it('空白のみのトークンで DocumentServerClient のコンストラクタが Error を投げる', () => {
    process.env.DOCUMENT_SERVER_TOKEN = '   ';

    expect(() => new DocumentServerClient()).toThrow(Error);
    expect(() => new DocumentServerClient()).toThrow('DOCUMENT_SERVER_TOKEN 環境変数が設定されていません');
  });
});

// ========================================
// 3. /health エンドポイントの認証除外確認
// ========================================

describe('/health エンドポイントの認証除外確認', () => {
  it('Authorization ヘッダーなしで /health が 200 を返す', async () => {
    const baseURL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';
    const response = await axios.get(`${baseURL}/health`, {
      // Authorization ヘッダーを明示的に付与しない
      headers: {},
    });
    expect(response.status).toBe(200);
  });
});
