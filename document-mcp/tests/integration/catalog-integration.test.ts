/**
 * カタログ・用語集・ロジックの結合テスト
 *
 * Phase 11 で実装した全機能（document-server API + document-mcp MCPツール）が
 * 連携して正しく動作することを検証する。
 *
 * テストの前提:
 * - document-server が起動していること（DOCUMENT_SERVER_URL）
 * - jupyter-server が起動していること（JUPYTER_SERVER_URL, JUPYTER_TOKEN）
 * - document-server/data/ にサンプルYAMLが配置されていること
 */

import { handleToolCall } from '../../src/tools/index.js';
import { type ToolCallResponse, parseToolCallResult } from '../setup.js';
import {
  checkJupyterConnection,
  createWorkspace,
  createSession,
  executeCode,
  deleteSession,
  deleteWorkspace,
} from './helpers/jupyter-helper.js';
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
// 1. カタログ参照フロー
// ========================================

describe('カタログ参照フロー', () => {
  it('get_table_index でテーブルインデックスを取得できる', async () => {
    const parsed = await callTool('get_table_index');

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBeGreaterThanOrEqual(fixture.tables.minCount);
    expect(parsed.tables).toBeInstanceOf(Array);

    const tables = parsed.tables as Array<{
      table_name: string;
      display_name: string;
      summary: string;
      category: string;
    }>;
    const tableNames = tables.map((t) => t.table_name);
    for (const name of fixture.tables.indexKnownNames) {
      expect(tableNames).toContain(name);
    }
  });

  it('get_table_detail でテーブル詳細を取得できる', async () => {
    const { tableName, expectedColumns, keyTypeColumn } = fixture.tables.detail;
    const parsed = await callTool('get_table_detail', {
      table_names: [tableName],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.tables).toBeInstanceOf(Array);

    const tables = parsed.tables as Array<{
      table_name: string;
      columns: Array<{
        name: string;
        type: string;
        description: string;
        key_type?: string;
        domain?: Record<string, unknown>;
      }>;
      data_source?: Record<string, unknown>;
    }>;
    expect(tables).toHaveLength(1);

    const table = tables[0];
    expect(table.table_name).toBe(tableName);

    // カラム定義の検証
    const columnNames = table.columns.map((c) => c.name);
    for (const col of expectedColumns) {
      expect(columnNames).toContain(col);
    }

    // key_type による外部キー情報
    const keyCol = table.columns.find((c) => c.name === keyTypeColumn);
    expect(keyCol?.key_type).toBeDefined();
    expect(keyCol?.domain).toBeDefined();
  });

  it('get_table_detail で key_types を持つカラムが返却される', async () => {
    const kt = fixture.tables.keyTypes;
    if (!kt) {
      console.warn('この環境には key_types を持つテーブルがありません。スキップ');
      return;
    }

    const parsed = await callTool('get_table_detail', {
      table_names: [kt.tableName],
    });

    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<{
      table_name: string;
      columns: Array<{
        name: string;
        key_type?: string;
        key_types?: Array<{ value: string; condition: string }>;
      }>;
    }>;
    const table = tables[0];

    // key_types カラムの検証
    const col = table.columns.find((c) => c.name === kt.columnName);
    expect(col).toBeDefined();
    expect(col?.key_types).toBeInstanceOf(Array);
    expect(col?.key_types).toHaveLength(kt.count);

    const keyTypes = col!.key_types!;
    for (const expected of kt.values) {
      expect(keyTypes).toContainEqual(expected);
    }

    // key_type は設定されていないこと（排他）
    expect(col?.key_type).toBeFalsy();
  });

  it('key_type と key_types が同一テーブル内で混在できる', async () => {
    const kt = fixture.tables.keyTypes;
    if (!kt) {
      console.warn('この環境には key_types を持つテーブルがありません。スキップ');
      return;
    }

    const parsed = await callTool('get_table_detail', {
      table_names: [kt.tableName],
    });

    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<{
      table_name: string;
      columns: Array<{
        name: string;
        key_type?: string;
        key_types?: Array<{ value: string; condition: string }>;
      }>;
    }>;
    const table = tables[0];

    // keyTypeColumnName は key_type のみ
    const keyTypeCol = table.columns.find((c) => c.name === kt.keyTypeColumnName);
    expect(keyTypeCol?.key_type).toBeDefined();
    expect(keyTypeCol?.key_types).toBeFalsy();

    // columnName は key_types のみ
    const keyTypesCol = table.columns.find((c) => c.name === kt.columnName);
    expect(keyTypesCol?.key_types).toBeDefined();
    expect(keyTypesCol?.key_type).toBeFalsy();
  });
});

// ========================================
// 1.5. 柔軟な統計項目（statistics.additional）
// ========================================

describe('柔軟な統計項目（statistics.additional）', () => {
  const stats = fixture.tables.statisticsAdditional;

  it('get_table_detail で statistics.additional にカスタム統計項目が含まれる', async () => {
    if (!stats) {
      console.warn('この環境には statistics.additional を持つテーブルがありません。スキップ');
      return;
    }

    const parsed = await callTool('get_table_detail', {
      table_names: [stats.tableName],
    });

    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<{
      table_name: string;
      statistics: {
        row_count: number;
        date_range: { from: string; to: string };
        update_frequency: string;
        additional: Record<string, unknown>;
      };
    }>;
    expect(tables).toHaveLength(1);

    const table = tables[0];
    const { additional } = table.statistics;

    // カスタム統計項目の検証
    for (const [key, value] of Object.entries(stats.expectedAdditional)) {
      expect(additional[key]).toEqual(value);
    }
  });

  it('additional 未定義テーブルで空オブジェクトが返却される', async () => {
    if (!stats) {
      console.warn('この環境には statistics.additional テストの対象がありません。スキップ');
      return;
    }

    const parsed = await callTool('get_table_detail', {
      table_names: [stats.noAdditionalTableName],
    });

    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<{
      table_name: string;
      statistics: {
        additional: Record<string, unknown>;
      };
    }>;
    expect(tables).toHaveLength(1);

    const table = tables[0];
    expect(table.statistics.additional).toEqual({});
  });

  it('additional と既知フィールドが共存する', async () => {
    if (!stats) {
      console.warn('この環境には statistics.additional テストの対象がありません。スキップ');
      return;
    }

    const parsed = await callTool('get_table_detail', {
      table_names: [stats.tableName],
    });

    expect(parsed.success).toBe(true);
    const tables = parsed.tables as Array<{
      table_name: string;
      statistics: {
        row_count: number;
        date_range: { from: string; to: string };
        update_frequency: string;
        additional: Record<string, unknown>;
      };
    }>;
    const table = tables[0];

    // 既知フィールドの検証
    expect(table.statistics.row_count).toBe(stats.knownFields.row_count);
    expect(table.statistics.date_range).toEqual(stats.knownFields.date_range);
    expect(table.statistics.update_frequency).toBe(stats.knownFields.update_frequency);

    // additional も同時に存在
    expect(Object.keys(table.statistics.additional).length).toBe(stats.additionalCount);
  });
});

// ========================================
// 2. 用語集参照フロー
// ========================================

describe('用語集参照フロー', () => {
  it('get_term_index で用語インデックスを取得できる', async () => {
    const parsed = await callTool('get_term_index');

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBeGreaterThanOrEqual(fixture.terms.minCount);
    expect(parsed.terms).toBeInstanceOf(Array);

    const terms = parsed.terms as Array<{ name: string; summary: string }>;
    const termNames = terms.map((t) => t.name);
    for (const name of fixture.terms.indexKnownNames) {
      expect(termNames).toContain(name);
    }
  });

  it('get_term_detail で用語詳細を取得し、関連用語を再帰的に解決できる', async () => {
    const { termName, relatedTermName } = fixture.terms.detail;

    // Phase 1: 対象用語の詳細取得
    const termParsed = await callTool('get_term_detail', {
      term_names: [termName],
    });

    expect(termParsed.success).toBe(true);
    expect(termParsed.terms).toBeInstanceOf(Array);

    const terms = termParsed.terms as Array<{
      name: string;
      definition: string;
      aliases: string[];
      related_terms: string[];
      values?: Array<{ label: string; description: string }>;
    }>;
    expect(terms).toHaveLength(1);

    const term = terms[0];
    expect(term.name).toBe(termName);
    expect(term.definition).toBeDefined();
    expect(term.aliases).toBeInstanceOf(Array);

    // Phase 2: 関連用語の再帰的解決（利用可能な場合のみ）
    if (relatedTermName) {
      expect(term.related_terms).toContain(relatedTermName);

      const relatedParsed = await callTool('get_term_detail', {
        term_names: [relatedTermName],
      });

      expect(relatedParsed.success).toBe(true);
      const relatedTerms = relatedParsed.terms as Array<{
        name: string;
        definition: string;
      }>;
      expect(relatedTerms[0].name).toBe(relatedTermName);
      expect(relatedTerms[0].definition).toBeDefined();
    }
  });
});

// ========================================
// 3. ロジック参照フロー
// ========================================

describe('ロジック参照フロー', () => {
  it('get_logic_index でロジックインデックスを取得できる', async () => {
    const parsed = await callTool('get_logic_index');

    expect(parsed.success).toBe(true);
    expect(parsed.total).toBeGreaterThanOrEqual(fixture.logic.minCount);
    expect(parsed.logic).toBeInstanceOf(Array);

    const logics = parsed.logic as Array<{
      logic_name: string;
      summary: string;
      category: string;
    }>;
    const logicNames = logics.map((l) => l.logic_name);
    for (const name of fixture.logic.indexKnownNames) {
      expect(logicNames).toContain(name);
    }
  });

  it('get_logic_detail + get_logic_code でメタ情報とコードを取得できる', async () => {
    const { logicName, language, usageType, inputTables, codeContains } = fixture.logic.detail;

    // メタ情報取得
    const detailParsed = await callTool('get_logic_detail', {
      logic_names: [logicName],
    });

    expect(detailParsed.success).toBe(true);
    expect(detailParsed.logic).toBeInstanceOf(Array);

    const logics = detailParsed.logic as Array<{
      logic_name: string;
      language: string;
      usage_type: string;
      input_tables: string[];
      output_description: string;
    }>;
    expect(logics).toHaveLength(1);

    const meta = logics[0];
    expect(meta.logic_name).toBe(logicName);
    expect(meta.language).toBe(language);
    expect(meta.usage_type).toBe(usageType);
    for (const table of inputTables) {
      expect(meta.input_tables).toContain(table);
    }
    expect(meta.output_description).toBeDefined();

    // コード取得
    const codeParsed = await callTool('get_logic_code', {
      logic_name: logicName,
    });

    expect(codeParsed.success).toBe(true);
    expect(codeParsed.logic_name).toBe(logicName);
    expect(codeParsed.language).toBe(language);
    expect(codeParsed.code).toBeDefined();
    expect(codeParsed.code as string).toContain(codeContains);
  });
});

// ========================================
// 4. 一括取得と部分エラー
// ========================================

describe('一括取得と部分エラー', () => {
  const partialErrorCases = [
    {
      toolName: 'get_table_detail',
      paramKey: 'table_names',
      existingName: fixture.partialError.existingTable,
      nonExistentName: '存在しないテーブル',
      resultKey: 'tables',
      nameField: 'table_name',
    },
    {
      toolName: 'get_term_detail',
      paramKey: 'term_names',
      existingName: fixture.partialError.existingTerm,
      nonExistentName: '存在しない用語',
      resultKey: 'terms',
      nameField: 'name',
    },
    {
      toolName: 'get_logic_detail',
      paramKey: 'logic_names',
      existingName: fixture.partialError.existingLogic,
      nonExistentName: '存在しないロジック',
      resultKey: 'logic',
      nameField: 'logic_name',
    },
  ];

  it.each(partialErrorCases)(
    '$toolName で存在するものと存在しないものを混在指定できる',
    async ({ toolName, paramKey, existingName, nonExistentName, resultKey, nameField }) => {
      const parsed = await callTool(toolName, {
        [paramKey]: [existingName, nonExistentName],
      });

      expect(parsed.success).toBe(true);

      const items = parsed[resultKey] as Array<Record<string, string>>;
      expect(items).toHaveLength(1);
      expect(items[0][nameField]).toBe(existingName);

      const notFound = parsed.not_found as string[];
      expect(notFound).toContain(nonExistentName);
    },
  );
});

// ========================================
// 5. E2Eフロー: コンテキスト参照→コード構築→Jupyter実行
// ========================================

describe('E2Eフロー: コンテキスト参照→コード構築→Jupyter実行', () => {
  let workspaceId: string | null = null;
  let sessionId: string | null = null;
  let jupyterAvailable = false;

  beforeAll(async () => {
    if (!fixture.e2eAvailable) {
      console.warn('この環境ではE2Eテスト（Python実行）をサポートしていません。スキップ');
      return;
    }
    jupyterAvailable = await checkJupyterConnection();
    if (!jupyterAvailable) {
      console.warn('jupyter-server に接続できません。E2Eテストをスキップします。');
    }
  });

  afterEach(async () => {
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch (e) {
        console.warn(`テスト後のセッション削除に失敗 (${sessionId}):`, e);
      }
      sessionId = null;
    }
    if (workspaceId) {
      try {
        await deleteWorkspace(workspaceId);
      } catch (e) {
        console.warn(`テスト後のワークスペース削除に失敗 (${workspaceId}):`, e);
      }
      workspaceId = null;
    }
  });

  /**
   * Phase 1: document-mcp MCPツールでコンテキスト情報を収集
   */
  async function collectContext(): Promise<{
    tables: Array<{ table_name: string; columns: Array<{ name: string; type: string }> }>;
    logicCode: string;
  }> {
    const { detail } = fixture.tables;
    // テーブル詳細を取得（E2E は sample 専用: purchase_history + customer_master）
    const tableParsed = await callTool('get_table_detail', {
      table_names: ['purchase_history', 'customer_master'],
    });
    expect(tableParsed.success).toBe(true);

    const tables = tableParsed.tables as Array<{
      table_name: string;
      columns: Array<{ name: string; type: string }>;
    }>;
    expect(tables).toHaveLength(2);

    const txnTable = tables.find((t) => t.table_name === 'purchase_history');
    const custTable = tables.find((t) => t.table_name === 'customer_master');
    expect(txnTable).toBeDefined();
    expect(custTable).toBeDefined();

    // 用語詳細を取得
    const termParsed = await callTool('get_term_detail', {
      term_names: [fixture.terms.detail.termName],
    });
    expect(termParsed.success).toBe(true);

    // 既存ロジックのコードを取得
    const codeParsed = await callTool('get_logic_code', {
      logic_name: fixture.logic.detail.logicName,
    });
    expect(codeParsed.success).toBe(true);

    const logicCode = codeParsed.code as string;
    expect(logicCode).toContain(fixture.logic.detail.codeContains);

    return { tables, logicCode };
  }

  /**
   * Phase 2: 取得したコンテキストから分析用Pythonコードを構築
   *
   * NOTE: logicCode は document-server の信頼できるYAMLデータから取得したコード。
   * テスト環境の隔離されたJupyterカーネル内でのみ実行される。
   */
  function buildAnalysisCode(logicCode: string): string {
    return `
import pandas as pd
import json

# テスト用データ（カタログのカラム情報に基づいて構築）
df_transactions = pd.DataFrame({
    'customer_id': ['C001', 'C001', 'C002', 'C002'],
    'store_code': ['S01', 'S01', 'S01', 'S02'],
    'amount': [1000, 2000, 1500, 3000]
})
df_customers = pd.DataFrame({
    'customer_id': ['C001', 'C002'],
    'loyalty_rank': ['Gold', 'Silver']
})

# 既存ロジック（get_logic_code で取得したコード）の関数を定義
${logicCode}

# 実行
result = aggregate_sales(df_transactions, df_customers)
print(result.to_json(orient='records'))
`;
  }

  /**
   * Phase 3: Jupyter上でコードを実行し結果を検証
   */
  async function executeOnJupyter(pythonCode: string): Promise<Record<string, unknown>[]> {
    const workspace = await createWorkspace(`integration-test-${Date.now()}`);
    workspaceId = workspace.workspace_id;

    const session = await createSession(workspaceId);
    sessionId = session.session_id;

    const execResult = await executeCode(session.kernel_id, pythonCode, 60);

    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toBeDefined();
    expect(execResult.stdout.length).toBeGreaterThan(0);

    const outputJson = JSON.parse(execResult.stdout.trim()) as Record<string, unknown>[];
    expect(outputJson).toBeInstanceOf(Array);
    expect(outputJson.length).toBeGreaterThan(0);

    return outputJson;
  }

  it('コンテキスト参照→コード構築→Jupyter実行の一連フローが動作する', async () => {
    if (!fixture.e2eAvailable) {
      console.warn('E2Eテスト非対応環境のためスキップ');
      return;
    }
    if (!jupyterAvailable) {
      console.warn('jupyter-server に接続できないためスキップ');
      return;
    }

    // Phase 1: コンテキスト収集
    const { logicCode } = await collectContext();

    // Phase 2: 分析コード構築
    const pythonCode = buildAnalysisCode(logicCode);

    // Phase 3: Jupyter実行
    const outputJson = await executeOnJupyter(pythonCode);

    // 集計結果のカラム確認
    const firstRow = outputJson[0];
    expect(firstRow).toHaveProperty('store_code');
    expect(firstRow).toHaveProperty('loyalty_rank');
    expect(firstRow).toHaveProperty('total_amount');
    expect(firstRow).toHaveProperty('customer_count');
  }, 60000); // 60秒タイムアウト
});
