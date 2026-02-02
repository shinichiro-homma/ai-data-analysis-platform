/**
 * 変数管理のワークフロー結合テスト
 *
 * コード実行→変数確認の一連のワークフローをテストする。
 * get_variables.test.ts では単一ツールのテストが中心だが、
 * このテストでは実際の分析フローをシミュレートした統合テストを行う。
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - 環境変数 JUPYTER_SERVER_URL, JUPYTER_TOKEN が設定されていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import { handleToolCall } from '../../src/tools/index.js';
import {
  generateTestNotebookName,
  cleanupNotebook,
  cleanupSession,
  checkJupyterConnection,
  parseToolCallResult,
  type ToolCallResponse,
} from '../setup.js';

// テスト用の型定義
interface Variable {
  name: string;
  type: string;
  value?: unknown;
  size?: string;
}

interface GetVariablesResponse extends ToolCallResponse {
  variables: Variable[];
}

interface DataFrameInfoResponse extends ToolCallResponse {
  shape: [number, number];
  columns: string[];
  dtypes: Record<string, string>;
  head: Array<Record<string, unknown>>;
  describe: Record<string, Record<string, number>>;
}

// テストヘルパー関数
async function createTestSession(createdSessionIds: string[]): Promise<string> {
  const createResult = await handleToolCall('session_create', {
    name: 'python3',
  });
  const createData = parseToolCallResult(createResult);
  expect(createData.success).toBe(true);

  const sessionId = createData.session_id as string;
  createdSessionIds.push(sessionId);
  return sessionId;
}

describe('変数管理のワークフローテスト', () => {
  const testNotebooks: string[] = [];
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    // Jupyter サーバーの接続確認
    await checkJupyterConnection();
  });

  afterEach(async () => {
    // テスト後のクリーンアップ
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const notebookPath of testNotebooks) {
      await cleanupNotebook(notebookPath);
    }
    testNotebooks.length = 0;
  });

  describe('データ読み込みと変数確認フロー', () => {
    test('データ読み込み → get_variables で DataFrame を確認', async () => {
      // 1. セッション作成
      const sessionId = await createTestSession(createdSessionIds);

      // 2. pandas インポート & CSV データ模擬
      const importResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
import io

# CSV データを文字列として定義
csv_data = """name,age,city
Alice,30,Tokyo
Bob,25,Osaka
Charlie,35,Nagoya"""

# StringIO を使って読み込み
df = pd.read_csv(io.StringIO(csv_data))
        `,
      });
      const importData = parseToolCallResult(importResult);
      expect(importData.success).toBe(true);

      // 3. get_variables で変数一覧取得
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });

      // 4. DataFrame 変数が含まれていることを確認
      const getVariablesData = parseToolCallResult(getVariablesResult) as GetVariablesResponse;
      expect(getVariablesData.success).toBe(true);

      const dfVariable = getVariablesData.variables.find(v => v.name === 'df');
      expect(dfVariable).toBeDefined();
      expect(dfVariable?.type).toBe('DataFrame');
      expect(dfVariable?.size).toContain('rows');
    }, 15000);
  });

  describe('get_dataframe_info の統合テスト', () => {
    test('DataFrame 作成 → get_dataframe_info で詳細情報取得', async () => {
      // 1. セッション作成
      const sessionId = await createTestSession(createdSessionIds);

      // 2. DataFrame 作成（カラム名、型、サンプルデータ定義）
      const createDfResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
import numpy as np

df = pd.DataFrame({
    'int_col': [1, 2, 3, 4, 5],
    'float_col': [1.1, 2.2, 3.3, 4.4, 5.5],
    'str_col': ['a', 'b', 'c', 'd', 'e'],
    'bool_col': [True, False, True, False, True]
})
        `,
      });
      const createDfData = parseToolCallResult(createDfResult);
      expect(createDfData.success).toBe(true);

      // 3. get_dataframe_info を呼び出し
      const dfInfoResult = await handleToolCall('get_dataframe_info', {
        session_id: sessionId,
        variable_name: 'df',
      });

      // 4. shape, columns, dtypes, head, describe を検証
      const dfInfoData = parseToolCallResult(dfInfoResult) as DataFrameInfoResponse;
      expect(dfInfoData.success).toBe(true);

      // shape（配列形式: [rows, columns]）
      expect(dfInfoData.shape).toBeDefined();
      expect(dfInfoData.shape[0]).toBe(5); // rows
      expect(dfInfoData.shape[1]).toBe(4); // columns

      // columns（文字列配列）
      expect(dfInfoData.columns).toBeDefined();
      expect(dfInfoData.columns).toHaveLength(4);
      expect(dfInfoData.columns).toContain('int_col');
      expect(dfInfoData.columns).toContain('float_col');
      expect(dfInfoData.columns).toContain('str_col');
      expect(dfInfoData.columns).toContain('bool_col');

      // dtypes（オブジェクト形式）
      expect(dfInfoData.dtypes).toBeDefined();
      expect(dfInfoData.dtypes.int_col).toBeDefined();
      expect(dfInfoData.dtypes.float_col).toBeDefined();

      // head（配列形式）
      expect(dfInfoData.head).toBeDefined();
      expect(dfInfoData.head.length).toBeGreaterThan(0);
      expect(dfInfoData.head[0]).toHaveProperty('int_col');

      // describe（オブジェクト形式）
      expect(dfInfoData.describe).toBeDefined();
      expect(dfInfoData.describe.int_col).toBeDefined();
      expect(dfInfoData.describe.int_col.count).toBeDefined();
      expect(dfInfoData.describe.int_col.mean).toBeDefined();
    }, 15000);
  });

  describe('複数変数の追跡テスト', () => {
    test('複数コード実行 → 変数が累積して保持される', async () => {
      // 1. セッション作成
      const sessionId = await createTestSession(createdSessionIds);

      // 2. x = 10 実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'x = 10',
      });

      // 3. y = 20 実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'y = 20',
      });

      // 4. z = x + y 実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'z = x + y',
      });

      // 5. get_variables で x, y, z すべて存在確認
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });

      const getVariablesData = parseToolCallResult(getVariablesResult) as GetVariablesResponse;
      expect(getVariablesData.success).toBe(true);

      // すべての変数が存在することを確認
      const xVariable = getVariablesData.variables.find(v => v.name === 'x');
      const yVariable = getVariablesData.variables.find(v => v.name === 'y');
      const zVariable = getVariablesData.variables.find(v => v.name === 'z');

      expect(xVariable).toBeDefined();
      expect(yVariable).toBeDefined();
      expect(zVariable).toBeDefined();

      // 6. z の値が 30 であることを確認
      expect(zVariable?.value).toBe(30);
    }, 15000);

    test('変数の上書き → 新しい値に更新される', async () => {
      // 1. セッション作成
      const sessionId = await createTestSession(createdSessionIds);

      // 2. x = 100 実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'x = 100',
      });

      // 3. x = 200 実行
      await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'x = 200',
      });

      // 4. get_variables で x = 200 を確認
      const getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });

      const getVariablesData = parseToolCallResult(getVariablesResult) as GetVariablesResponse;
      expect(getVariablesData.success).toBe(true);

      const xVariable = getVariablesData.variables.find(v => v.name === 'x');
      expect(xVariable).toBeDefined();
      expect(xVariable?.value).toBe(200);
    });
  });

  describe('実践的な分析シナリオ', () => {
    test('インポート → データ作成 → 変換 → 集計', async () => {
      // 1. セッション作成
      const sessionId = await createTestSession(createdSessionIds);

      // 2. pandas, numpy インポート
      const importResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: 'import pandas as pd\nimport numpy as np',
      });
      const importData = parseToolCallResult(importResult);
      expect(importData.success).toBe(true);

      // 3. DataFrame 作成
      const createDfResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
df = pd.DataFrame({
    'category': ['A', 'B', 'A', 'B', 'A', 'B'],
    'value': [10, 20, 30, 40, 50, 60]
})
        `,
      });
      const createDfData = parseToolCallResult(createDfResult);
      expect(createDfData.success).toBe(true);

      // 変数確認（df が作成されていること）
      let getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });
      let getVariablesData = parseToolCallResult(getVariablesResult) as GetVariablesResponse;
      expect(getVariablesData.success).toBe(true);
      expect(getVariablesData.variables.some(v => v.name === 'df')).toBe(true);

      // 4. 列追加（df['new_col'] = ...）
      const addColResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: "df['doubled'] = df['value'] * 2",
      });
      const addColData = parseToolCallResult(addColResult);
      expect(addColData.success).toBe(true);

      // DataFrame の詳細情報確認（新しい列が追加されていること）
      const dfInfoResult = await handleToolCall('get_dataframe_info', {
        session_id: sessionId,
        variable_name: 'df',
      });
      const dfInfoData = parseToolCallResult(dfInfoResult) as DataFrameInfoResponse;
      expect(dfInfoData.success).toBe(true);
      expect(dfInfoData.columns).toContain('doubled');

      // 5. グループ集計（df.groupby().sum()）
      const groupbyResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: "grouped = df.groupby('category')['value'].sum()",
      });
      const groupbyData = parseToolCallResult(groupbyResult);
      expect(groupbyData.success).toBe(true);

      // 変数確認（grouped が作成されていること）
      getVariablesResult = await handleToolCall('get_variables', {
        session_id: sessionId,
      });
      getVariablesData = parseToolCallResult(getVariablesResult) as GetVariablesResponse;
      expect(getVariablesData.success).toBe(true);
      expect(getVariablesData.variables.some(v => v.name === 'grouped')).toBe(true);
    }, 15000);
  });
});

describe('get_dataframe_info エラーハンドリング', () => {
  const createdSessionIds: string[] = [];

  beforeAll(async () => {
    await checkJupyterConnection();
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;
  });

  test('存在しない変数名を指定 → NOT_FOUND エラー', async () => {
    // 1. セッション作成
    const sessionId = await createTestSession(createdSessionIds);

    // 2. get_dataframe_info('non_existent_var')
    const dfInfoResult = await handleToolCall('get_dataframe_info', {
      session_id: sessionId,
      variable_name: 'non_existent_var',
    });

    // 3. エラーレスポンス確認
    const dfInfoData = parseToolCallResult(dfInfoResult);
    expect(dfInfoData.success).toBe(false);
    expect(dfInfoData.error).toBeDefined();

    const error = dfInfoData.error as { code?: string; message?: string };
    expect(error.code).toMatch(/NOT_FOUND|VARIABLE_NOT_FOUND|NameError/);
  }, 15000);

  test('DataFrame 以外の変数を指定 → INVALID_VARIABLE_TYPE エラー', async () => {
    // 1. セッション作成
    const sessionId = await createTestSession(createdSessionIds);

    // 2. x = 42 実行
    await handleToolCall('execute_code', {
      session_id: sessionId,
      code: 'x = 42',
    });

    // 3. get_dataframe_info('x')
    const dfInfoResult = await handleToolCall('get_dataframe_info', {
      session_id: sessionId,
      variable_name: 'x',
    });

    // 4. INVALID_VARIABLE_TYPE エラーを確認
    const dfInfoData = parseToolCallResult(dfInfoResult);
    expect(dfInfoData.success).toBe(false);
    expect(dfInfoData.error).toBeDefined();

    const error = dfInfoData.error as { code?: string; message?: string };
    expect(error.code).toMatch(/INVALID_VARIABLE_TYPE|TypeError/);
    expect(error.message).toBeDefined();
  }, 20000);
});
