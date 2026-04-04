/**
 * SQL 分析フロー E2E テスト
 *
 * カタログ参照→SQL実行API→CSV保存→pandas読み込み→分析 の一連フローを検証する。
 * Phase 12.2 の e2e-workflow.test.ts が pd.read_sql_query() で直接 DB 接続するのに対し、
 * 本テストは POST /api/sql/execute API 経由で SQL を実行する。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  checkServices,
  getTableIndex,
  getTableDetail,
  getTermDetail,
  createWorkspace,
  createSession,
  executeCode,
  executeSql,
  deleteSession,
  deleteWorkspace,
  jupyterPost,
} from './helpers/api-client.js';

// --- テスト全体のセットアップ ---

let servicesAvailable = false;

beforeAll(async () => {
  const status = await checkServices();
  servicesAvailable = status.document && status.jupyter;
  if (!servicesAvailable) {
    console.warn(
      'サービスに接続できません。E2E テストをスキップします。',
      `document-server: ${status.document ? 'OK' : 'NG'}`,
      `jupyter-server: ${status.jupyter ? 'OK' : 'NG'}`,
    );
  }
});

// --- クリーンアップ用の状態管理 ---

let currentSessionId: string | null = null;
let currentWorkspaceId: string | null = null;

afterEach(async () => {
  if (currentSessionId) {
    await deleteSession(currentSessionId);
    currentSessionId = null;
  }
  if (currentWorkspaceId) {
    await deleteWorkspace(currentWorkspaceId);
    currentWorkspaceId = null;
  }
});

/**
 * ワークスペースとセッションを作成するヘルパー
 */
async function setupJupyterEnv(testName: string): Promise<{
  workspaceId: string;
  kernelId: string;
  sessionId: string;
}> {
  const wsName = `e2e-sql-${testName}-${Date.now()}`;
  const ws = await createWorkspace(wsName);
  currentWorkspaceId = ws.workspace_id;

  const session = await createSession(ws.workspace_id);
  currentSessionId = session.session_id;

  return {
    workspaceId: ws.workspace_id,
    kernelId: session.kernel_id,
    sessionId: session.session_id,
  };
}

// ========================================================================
// シナリオ 1: カタログ参照→SQL実行→CSV読み込み→分析
// ========================================================================

describe('シナリオ 1: カタログ→SQL→CSV→分析', () => {
  it('カタログでカラム情報を取得しSQLを構築できる', async () => {
    if (!servicesAvailable) return;

    // カタログからテーブル詳細を取得
    const detail = await getTableDetail(['purchase_history']);
    expect(detail.tables).toHaveLength(1);

    const table = detail.tables[0];
    const columnNames = table.columns.map((c) => c.name);
    expect(columnNames).toContain('customer_id');
    expect(columnNames).toContain('amount');

    // カラム情報を使ってSQLを構築し、API経由で実行
    const { workspaceId } = await setupJupyterEnv('catalog-sql');
    const selectedCols = columnNames
      .filter((c) => ['customer_id', 'transaction_date', 'amount', 'status'].includes(c))
      .join(', ');

    const result = await executeSql(
      workspaceId,
      `SELECT ${selectedCols} FROM purchase_history LIMIT 10`,
      'catalog_query.csv',
    );

    expect(result.success).toBe(true);
    expect(result.row_count).toBeGreaterThan(0);
    expect(result.row_count).toBeLessThanOrEqual(10);
    expect(result.columns).toContain('customer_id');
    expect(result.columns).toContain('amount');
    expect(result.file_path).toContain('catalog_query.csv');
    expect(result.file_size_bytes).toBeGreaterThan(0);
  });

  it('SQL実行結果がCSVとして保存されpandasで読み込める', { timeout: 60_000 }, async () => {
    if (!servicesAvailable) return;

    // SQL実行でCSV保存
    const { workspaceId, kernelId } = await setupJupyterEnv('csv-read');
    const sqlResult = await executeSql(
      workspaceId,
      'SELECT customer_id, amount, status FROM purchase_history LIMIT 5',
      'read_test.csv',
    );
    expect(sqlResult.success).toBe(true);

    // pandasでCSVを読み込み
    const code = `
import pandas as pd

df = pd.read_csv('data/read_test.csv')
print(f"rows={len(df)}")
print(f"columns={list(df.columns)}")
print(f"dtypes={dict(df.dtypes)}")
`;
    const execResult = await executeCode(kernelId, code);
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain(`rows=${sqlResult.row_count}`);
    expect(execResult.stdout).toContain('customer_id');
    expect(execResult.stdout).toContain('amount');
    expect(execResult.stdout).toContain('status');
  });
});

// ========================================================================
// シナリオ 2: 複数テーブル JOIN→分析
// ========================================================================

describe('シナリオ 2: JOINクエリ→分析', () => {
  it('2テーブルのkey_type/domain情報からJOIN SQLを実行できる', { timeout: 60_000 }, async () => {
    if (!servicesAvailable) return;

    // カタログから2テーブルの詳細を取得
    const detail = await getTableDetail(['purchase_history', 'customer_master']);
    expect(detail.tables).toHaveLength(2);

    const txTable = detail.tables.find((t) => t.table_name === 'purchase_history');
    const custTable = detail.tables.find((t) => t.table_name === 'customer_master');
    expect(txTable).toBeDefined();
    expect(custTable).toBeDefined();

    // domain 情報で JOIN キーを特定
    const txFkCol = txTable!.columns.find(
      (c) => c.domain && 'master_table' in c.domain && c.domain.master_table === 'customer_master',
    );
    expect(txFkCol).toBeDefined();
    const masterCol = (txFkCol!.domain as { master_column: string }).master_column;
    expect(masterCol).toBeTruthy();

    // JOIN クエリを実行
    const { workspaceId, kernelId } = await setupJupyterEnv('join-query');
    const sqlResult = await executeSql(
      workspaceId,
      `SELECT
        c.customer_id,
        c.customer_name,
        COUNT(t.transaction_detail_id) AS tx_count,
        COALESCE(SUM(t.amount), 0) AS total_amount
      FROM customer_master c
      LEFT JOIN purchase_history t
        ON c.customer_id = t.customer_id
        AND t.status = 'completed'
      GROUP BY c.customer_id, c.customer_name
      ORDER BY total_amount DESC
      LIMIT 10`,
      'join_result.csv',
    );
    expect(sqlResult.success).toBe(true);
    expect(sqlResult.row_count).toBeGreaterThan(0);
    expect(sqlResult.columns).toContain('customer_id');
    expect(sqlResult.columns).toContain('total_amount');

    // CSVをpandasで読み込み分析
    const code = `
import pandas as pd

df = pd.read_csv('data/join_result.csv')
print(f"rows={len(df)}")
print(f"columns={list(df.columns)}")
print(f"total_amount_sum={df['total_amount'].sum()}")
print(f"has_customer_name={'customer_name' in df.columns}")
`;
    const execResult = await executeCode(kernelId, code);
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain('rows=');
    expect(execResult.stdout).toContain('has_customer_name=True');
  });
});

// ========================================================================
// シナリオ 3: SQLエラーハンドリング
// ========================================================================

describe('シナリオ 3: SQLエラーハンドリング', () => {
  it('SELECT以外のSQLが拒否される', async () => {
    if (!servicesAvailable) return;

    const { workspaceId } = await setupJupyterEnv('sql-reject');

    // INSERT文
    const insertResult = await jupyterPost('/api/sql/execute', {
      workspace_id: workspaceId,
      sql: "INSERT INTO purchase_history (customer_id) VALUES ('test')",
      filename: 'should_fail.csv',
    });
    expect(insertResult.status).toBeGreaterThanOrEqual(400);

    // DELETE文
    const deleteResult = await jupyterPost('/api/sql/execute', {
      workspace_id: workspaceId,
      sql: 'DELETE FROM purchase_history WHERE 1=0',
      filename: 'should_fail.csv',
    });
    expect(deleteResult.status).toBeGreaterThanOrEqual(400);

    // UPDATE文
    const updateResult = await jupyterPost('/api/sql/execute', {
      workspace_id: workspaceId,
      sql: 'UPDATE purchase_history SET amount = 0 WHERE 1=0',
      filename: 'should_fail.csv',
    });
    expect(updateResult.status).toBeGreaterThanOrEqual(400);
  });

  it('存在しないテーブル/構文エラーで適切なエラーが返る', async () => {
    if (!servicesAvailable) return;

    const { workspaceId } = await setupJupyterEnv('sql-error');

    // 存在しないテーブル
    const noTableResult = await jupyterPost('/api/sql/execute', {
      workspace_id: workspaceId,
      sql: 'SELECT * FROM nonexistent_table_xyz',
      filename: 'no_table.csv',
    });
    expect(noTableResult.status).toBeGreaterThanOrEqual(400);
    expect(noTableResult.body).toHaveProperty('error');

    // 構文エラー
    const syntaxResult = await jupyterPost('/api/sql/execute', {
      workspace_id: workspaceId,
      sql: 'SELECTT * FROMM broken',
      filename: 'syntax_error.csv',
    });
    expect(syntaxResult.status).toBeGreaterThanOrEqual(400);
    expect(syntaxResult.body).toHaveProperty('error');
  });
});

// ========================================================================
// シナリオ 4: 完全統合フロー（用語→カタログ→SQL→CSV→分析）
// ========================================================================

describe('シナリオ 4: 完全統合フロー', () => {
  it('用語解決→テーブル特定→SQL実行→CSV読み込み→分析の一連フローが成功する', { timeout: 120_000 }, async () => {
    if (!servicesAvailable) return;

    // Phase 1: 用語解決
    const termDetail = await getTermDetail(['ロイヤルティランク']);
    expect(termDetail.terms).toHaveLength(1);
    const term = termDetail.terms[0];
    expect(term.definition).toBeTruthy();

    // Phase 2: テーブル特定（用語に関連するテーブルを特定）
    const tableIndex = await getTableIndex();
    expect(tableIndex.total).toBeGreaterThanOrEqual(2);

    const tableDetail = await getTableDetail(['purchase_history', 'customer_master']);
    expect(tableDetail.tables).toHaveLength(2);

    const txTable = tableDetail.tables.find((t) => t.table_name === 'purchase_history');
    const custTable = tableDetail.tables.find((t) => t.table_name === 'customer_master');
    expect(txTable).toBeDefined();
    expect(custTable).toBeDefined();

    // Phase 3: SQL実行（API経由でCSV保存）
    const { workspaceId, kernelId } = await setupJupyterEnv('full-flow');

    const sqlResult = await executeSql(
      workspaceId,
      `SELECT
          c.customer_id,
          c.customer_name,
          COUNT(t.transaction_detail_id) AS tx_count,
          COALESCE(SUM(t.amount), 0) AS total_amount
        FROM customer_master c
        LEFT JOIN purchase_history t
          ON c.customer_id = t.customer_id
          AND t.status = 'completed'
        GROUP BY c.customer_id, c.customer_name
        ORDER BY total_amount DESC`,
      'full_flow_result.csv',
    );
    expect(sqlResult.success).toBe(true);
    expect(sqlResult.row_count).toBeGreaterThan(0);
    expect(sqlResult.file_path).toContain('full_flow_result.csv');

    // Phase 4: CSV読み込み→分析（execute_code経由）
    const analysisCode = `
import pandas as pd

# SQL実行結果のCSVを読み込み
df = pd.read_csv('data/full_flow_result.csv')

# 基本統計
total_customers = len(df)
total_revenue = df['total_amount'].sum()
avg_tx_count = df['tx_count'].mean()

# ロイヤルティランク相当の分類（用語定義に基づく）
df['rank'] = pd.cut(
    df['total_amount'],
    bins=[-1, 0, 10000, 50000, float('inf')],
    labels=['未購入', 'ブロンズ', 'シルバー', 'ゴールド']
)
rank_dist = df['rank'].value_counts().to_dict()

print(f"success=True")
print(f"total_customers={total_customers}")
print(f"total_revenue={total_revenue}")
print(f"avg_tx_count={avg_tx_count:.2f}")
print(f"rank_distribution={rank_dist}")
print(f"columns={list(df.columns)}")
`;
    const execResult = await executeCode(kernelId, analysisCode, 60);
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain('success=True');
    expect(execResult.stdout).toContain('total_customers=');
    expect(execResult.stdout).toContain('total_revenue=');
    expect(execResult.stdout).toContain('rank_distribution=');

    // 変数確認
    const varCheck = await executeCode(
      kernelId,
      "print(f'df_shape={df.shape}')\nprint(f'df_type={type(df).__name__}')",
    );
    expect(varCheck.success).toBe(true);
    expect(varCheck.stdout).toContain('df_type=DataFrame');
  });
});
