/**
 * データエクスポートの統合テスト（export_sql）
 *
 * 前提条件:
 * - jupyter-server が起動していること（docker-compose up -d）
 * - PostgreSQL が起動していること
 * - DATA_ENV=sample でサンプルデータが読み込まれていること
 */

import { describe, test, expect, beforeAll, afterEach } from 'vitest';
import axios from 'axios';
import { handleToolCall } from '../../src/tools/index.js';
import { jupyterClient } from '../../src/jupyter-client/client.js';
import { cleanupSession, cleanupWorkspace, checkJupyterConnection, parseToolCallResult } from '../setup.js';
import { resolveWorkspacePath } from '../../src/utils/workspace-path-store.js';

/** document-server の URL */
const DOCUMENT_SERVER_URL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';

/**
 * document-server の接続を確認する
 */
async function checkDocumentServerConnection(): Promise<boolean> {
  try {
    await axios.get(`${DOCUMENT_SERVER_URL}/health`, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe('データエクスポートの統合テスト（export_sql）', () => {
  const createdSessionIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  let documentServerAvailable = false;

  beforeAll(async () => {
    await checkJupyterConnection();
    documentServerAvailable = await checkDocumentServerConnection();
  });

  afterEach(async () => {
    for (const sessionId of createdSessionIds) {
      await cleanupSession(sessionId);
    }
    createdSessionIds.length = 0;

    for (const workspaceId of createdWorkspaceIds) {
      await cleanupWorkspace(workspaceId);
    }
    createdWorkspaceIds.length = 0;
  });

  /**
   * テスト用ワークスペース + notebook_path 付きセッションを作成するヘルパー
   */
  async function createTestEnvironment(testName: string): Promise<{ workspaceId: string; sessionId: string }> {
    const wsResult = await handleToolCall('workspace_create', {
      name: `test-exportsql-${testName}-${Date.now()}`,
    });
    const wsData = parseToolCallResult(wsResult);
    expect(wsData.success).toBe(true);
    const workspaceId = wsData.workspace_id as string;
    createdWorkspaceIds.push(workspaceId);

    // export_sql には notebook_path 付きセッションが必要
    const notebookName = `analysis-${testName}.ipynb`;
    const wsPath = await resolveWorkspacePath(workspaceId);
    await jupyterClient.createNotebook(`${wsPath}/${notebookName}`);

    const sessResult = await handleToolCall('session_create', {
      workspace_id: workspaceId,
      notebook_path: notebookName,
    });
    const sessData = parseToolCallResult(sessResult);
    expect(sessData.success).toBe(true);
    const sessionId = sessData.session_id as string;
    createdSessionIds.push(sessionId);

    return { workspaceId, sessionId };
  }

  // ========================================
  // A. 基本エクスポート機能テスト
  // ========================================

  describe('A. 基本エクスポート機能テスト', () => {
    test('A-1: Parquet エクスポート（デフォルト形式）- 必要なフィールドが含まれる', async () => {
      const { sessionId } = await createTestEnvironment('parquet-default');

      const result = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: "SELECT 1 AS id, 'test' AS name",
        filename: 'export_test.parquet',
      });
      const data = parseToolCallResult(result);
      expect(data.success).toBe(true);
      expect(data.file_path).toBeDefined();
      expect(data.row_count).toBeDefined();
      expect(data.file_size_bytes).toBeDefined();
      expect(data.format).toBe('parquet');
      expect(data.execution_time_ms).toBeDefined();
      expect(data.row_count).toBe(1);
      // クエリ保存の検証
      expect(data.query_file_path).toBeDefined();
      expect(data.query_file_path).toMatch(/^data\/queries\/\d{3}_.*\.sql$/);
    });

    test('A-2: CSV エクスポート（format: "csv" 指定）', async () => {
      const { sessionId } = await createTestEnvironment('csv-format');

      const result = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: "SELECT 1 AS id, 'hello' AS message",
        filename: 'export_test.csv',
        format: 'csv',
      });
      const data = parseToolCallResult(result);
      expect(data.success).toBe(true);
      expect(data.file_path).toBeDefined();
      expect(data.row_count).toBe(1);
      expect(data.file_size_bytes).toBeDefined();
      expect(data.format).toBe('csv');
      expect(data.execution_time_ms).toBeDefined();
    });

    test('A-3: Parquet エクスポート後に execute_code で pd.read_parquet して読み込み検証', async () => {
      const { sessionId } = await createTestEnvironment('parquet-read');

      // まず Parquet エクスポート
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: "SELECT 42 AS num_col, 'hello' AS str_col",
        filename: 'verify_parquet.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);

      // execute_code で読み込んで検証
      const readResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
df = pd.read_parquet('data/verify_parquet.parquet')
print(f"rows={len(df)}")
print(f"columns={','.join(df.columns.tolist())}")
print(f"num_col={df['num_col'].iloc[0]}")
print(f"str_col={df['str_col'].iloc[0]}")
`,
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);

      const stdout = readData.stdout as string;
      expect(stdout).toContain('rows=1');
      expect(stdout).toContain('columns=num_col,str_col');
      expect(stdout).toContain('num_col=42');
      expect(stdout).toContain('str_col=hello');
    });

    test('A-4: CSV エクスポート後に execute_code で pd.read_csv して読み込み検証', async () => {
      const { sessionId } = await createTestEnvironment('csv-read');

      // CSV エクスポート
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: "SELECT 100 AS value, 'world' AS label",
        filename: 'verify_csv.csv',
        format: 'csv',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);

      // execute_code で読み込んで検証
      const readResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
df = pd.read_csv('data/verify_csv.csv')
print(f"rows={len(df)}")
print(f"columns={','.join(df.columns.tolist())}")
print(f"value={df['value'].iloc[0]}")
print(f"label={df['label'].iloc[0]}")
`,
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);

      const stdout = readData.stdout as string;
      expect(stdout).toContain('rows=1');
      expect(stdout).toContain('columns=value,label');
      expect(stdout).toContain('value=100');
      expect(stdout).toContain('label=world');
    });

    test('A-5: data/ プレフィックス付き filename が自動除去されて正常にエクスポートされる', async () => {
      const { sessionId } = await createTestEnvironment('data-prefix');

      const result = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: 'SELECT 1 AS id',
        filename: 'data/prefix_test.parquet',
      });
      const data = parseToolCallResult(result);
      expect(data.success).toBe(true);
      expect(data.format).toBe('parquet');
      expect(data.row_count).toBe(1);
    });
  });

  // ========================================
  // B. バリデーション・エラーテスト
  // ========================================

  describe('B. バリデーション・エラーテスト', () => {
    test('B-1: 非SELECT文の拒否（INSERT 文 → バリデーションエラー）', async () => {
      const { sessionId } = await createTestEnvironment('non-select-reject');

      const result = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: "INSERT INTO some_table (col) VALUES ('value')",
        filename: 'reject_test.parquet',
      });
      const data = parseToolCallResult(result);
      expect(data.success).toBe(false);

      // エラーコードまたはメッセージで非SELECT拒否を確認
      const error = data.error as { code?: string; message?: string } | undefined;
      expect(error).toBeDefined();
      // SQL_NOT_ALLOWED など、エラーコードが設定されていること
      expect(error?.code).toBeTruthy();
    });

    test('B-2: タイムアウト設定（短いタイムアウトで重いクエリ → エラー）', async () => {
      const { sessionId } = await createTestEnvironment('timeout-test');

      // pg_sleep(5) を使って意図的にタイムアウトを引き起こす（timeout=1秒）
      const result = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: 'SELECT pg_sleep(5)',
        filename: 'timeout_test.parquet',
        timeout: 1,
      });
      const data = parseToolCallResult(result);
      expect(data.success).toBe(false);

      // タイムアウトエラーが返ること
      const error = data.error as { code?: string; message?: string } | undefined;
      expect(error).toBeDefined();
      expect(error?.code).toBeTruthy();
    });
  });

  // ========================================
  // C. 大量データのメモリ効率テスト
  // ========================================

  describe('C. 大量データのメモリ効率テスト', () => {
    test('C-1: generate_series で10万行以上のParquetエクスポート、行数一致確認', async () => {
      const { sessionId } = await createTestEnvironment('large-data-parquet');
      const targetRows = 100000;

      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: `SELECT generate_series AS id, 'row_' || generate_series AS label FROM generate_series(1, ${targetRows})`,
        filename: 'large_data.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);
      expect(exportData.row_count).toBe(targetRows);
      expect(exportData.file_size_bytes as number).toBeGreaterThan(0);
    }, 60000);

    test('C-2: エクスポート後に pd.read_parquet で読み込み、データ整合性検証', async () => {
      const { sessionId } = await createTestEnvironment('large-data-verify');
      const targetRows = 100000;

      // エクスポート
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: `SELECT generate_series AS id, (generate_series * 2) AS double_id FROM generate_series(1, ${targetRows})`,
        filename: 'large_verify.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);
      expect(exportData.row_count).toBe(targetRows);

      // pd.read_parquet で読み込み、行数と先頭・末尾データを検証
      const readResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
df = pd.read_parquet('data/large_verify.parquet')
print(f"rows={len(df)}")
print(f"first_id={df['id'].iloc[0]}")
print(f"last_id={df['id'].iloc[-1]}")
print(f"first_double={df['double_id'].iloc[0]}")
print(f"last_double={df['double_id'].iloc[-1]}")
`,
      });
      const readData = parseToolCallResult(readResult);
      expect(readData.success).toBe(true);

      const stdout = readData.stdout as string;
      expect(stdout).toContain(`rows=${targetRows}`);
      expect(stdout).toContain('first_id=1');
      expect(stdout).toContain(`last_id=${targetRows}`);
      expect(stdout).toContain('first_double=2');
      expect(stdout).toContain(`last_double=${targetRows * 2}`);
    }, 60000);
  });

  // ========================================
  // D. E2E: カタログ参照 → export_sql → execute_code
  // ========================================

  describe('D. E2E: カタログ参照 → export_sql → execute_code', () => {
    test('D-1: document-server からテーブル定義取得 → export_sql でDBテーブルをParquetエクスポート → execute_code で読み込み分析', async () => {
      if (!documentServerAvailable) {
        console.log('document-server is not available, skipping');
        return;
      }

      // 1. document-server からテーブル定義を取得
      const catalogResponse = await axios.post(
        `${DOCUMENT_SERVER_URL}/catalog/tables`,
        {
          table_names: ['customer_master'],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DOCUMENT_SERVER_TOKEN ?? ''}`,
          },
        },
      );
      expect(catalogResponse.status).toBe(200);

      const tables = catalogResponse.data.data.tables as Array<{
        table_name: string;
        data_source: { type: string };
        columns: Array<{ name: string; type: string }>;
      }>;
      expect(tables).toHaveLength(1);
      const tableDetail = tables[0];
      expect(tableDetail.table_name).toBe('customer_master');

      // カラム情報を確認
      const columnNames = tableDetail.columns.map((c) => c.name);
      expect(columnNames.length).toBeGreaterThan(0);

      // 2. テスト環境を作成
      const { sessionId } = await createTestEnvironment('e2e-catalog-export');

      // 3. export_sql で DB テーブルを Parquet エクスポート
      const exportResult = await handleToolCall('export_sql', {
        session_id: sessionId,
        sql: 'SELECT customer_id, customer_name FROM customer_master LIMIT 10',
        filename: 'customers.parquet',
      });
      const exportData = parseToolCallResult(exportResult);
      expect(exportData.success).toBe(true);
      expect(exportData.format).toBe('parquet');
      expect(exportData.row_count as number).toBeGreaterThan(0);
      expect(exportData.row_count as number).toBeLessThanOrEqual(10);

      // 4. execute_code で読み込んで分析
      const analysisResult = await handleToolCall('execute_code', {
        session_id: sessionId,
        code: `
import pandas as pd
import json

df = pd.read_parquet('data/customers.parquet')
result = {
    'row_count': len(df),
    'columns': df.columns.tolist(),
    'has_customer_id': 'customer_id' in df.columns,
    'has_customer_name': 'customer_name' in df.columns,
}
print(json.dumps(result, ensure_ascii=False))
`,
      });
      const analysisData = parseToolCallResult(analysisResult);
      expect(analysisData.success).toBe(true);

      const stdout = analysisData.stdout as string;
      const result = JSON.parse(stdout.trim());
      expect(result.row_count).toBeGreaterThan(0);
      expect(result.has_customer_id).toBe(true);
      expect(result.has_customer_name).toBe(true);
    });
  });
});
