/**
 * E2E テストシナリオ
 *
 * docker-compose で起動した全サービス（PostgreSQL, jupyter-server, document-server）に対して
 * 「カタログ参照→分析実行」の完全フローを検証する。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  checkServices,
  getTableIndex,
  getTableDetail,
  getTermIndex,
  getTermDetail,
  getLogicIndex,
  getLogicDetail,
  getLogicCode,
  createWorkspace,
  createSession,
  executeCode,
  deleteSession,
  deleteWorkspace,
  docPost,
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
  const wsName = `e2e-${testName}-${Date.now()}`;
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
// シナリオ 1: カタログ駆動の SQL 分析
// ========================================================================

describe('シナリオ 1: カタログ駆動の SQL 分析', () => {
  it('テーブルカタログからカラム情報を取得できる', async () => {
    if (!servicesAvailable) return;

    // テーブル一覧を取得
    const index = await getTableIndex();
    expect(index.total).toBeGreaterThanOrEqual(2);
    expect(index.tables.map((t) => t.table_name)).toContain('purchase_history');

    // テーブル詳細を取得
    const detail = await getTableDetail(['purchase_history']);
    expect(detail.tables).toHaveLength(1);
    expect(detail.not_found).toHaveLength(0);

    const table = detail.tables[0];
    expect(table.table_name).toBe('purchase_history');
    expect(table.columns.length).toBeGreaterThan(0);

    // カラム名の存在確認
    const columnNames = table.columns.map((c) => c.name);
    expect(columnNames).toContain('customer_id');
    expect(columnNames).toContain('transaction_date');
    expect(columnNames).toContain('amount');
    expect(columnNames).toContain('status');
  });

  it('カタログ情報を使って PostgreSQL に SQL を実行できる', async () => {
    if (!servicesAvailable) return;

    // カタログから情報取得
    const detail = await getTableDetail(['purchase_history']);
    const table = detail.tables[0];
    const columnNames = table.columns.map((c) => c.name);

    // Jupyter 環境セットアップ
    const { kernelId } = await setupJupyterEnv('scenario1-sql');

    // psycopg2 で SQL 実行
    const code = `
import pandas as pd
import os

db_url = os.environ.get("DATABASE_URL", "postgresql://jupyter:jupyter-dev-password@localhost:5432/analysis_db")

df = pd.read_sql_query(
    "SELECT customer_id, transaction_date, amount, status FROM purchase_history LIMIT 10",
    db_url
)
print(f"rows={len(df)}")
print(f"columns={list(df.columns)}")
print(df.head(3).to_string(index=False))
`;
    const result = await executeCode(kernelId, code);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('rows=');

    // カタログのカラム定義と実テーブルのカラムが一致する
    for (const col of ['customer_id', 'transaction_date', 'amount', 'status']) {
      expect(columnNames).toContain(col);
      expect(result.stdout).toContain(col);
    }
  });
});

// ========================================================================
// シナリオ 2: 用語解決→テーブル特定→分析
// ========================================================================

describe('シナリオ 2: 用語解決→テーブル特定→分析', () => {
  it('用語詳細を取得し定義と値体系を確認できる', async () => {
    if (!servicesAvailable) return;

    // 用語一覧を取得
    const index = await getTermIndex();
    expect(index.total).toBeGreaterThanOrEqual(1);

    const termNames = index.terms.map((t) => t.name);
    expect(termNames).toContain('ロイヤルティランク');

    // 用語詳細を取得
    const detail = await getTermDetail(['ロイヤルティランク']);
    expect(detail.terms).toHaveLength(1);

    const term = detail.terms[0];
    expect(term.definition).toBeTruthy();
    expect(term.definition.length).toBeGreaterThan(0);
  });

  it('用語情報を基に関連テーブルを特定し分析を実行できる', async () => {
    if (!servicesAvailable) return;

    // 用語から関連テーブルを推定
    const termDetail = await getTermDetail(['ロイヤルティランク']);
    const term = termDetail.terms[0];
    expect(term.definition).toBeTruthy();

    // テーブルカタログから購買データを取得
    const tableDetail = await getTableDetail(['purchase_history', 'customer_master']);
    expect(tableDetail.tables).toHaveLength(2);

    // Jupyter で用語定義に基づいた分析実行
    const { kernelId } = await setupJupyterEnv('scenario2-term');

    const code = `
import pandas as pd
import os

db_url = os.environ.get("DATABASE_URL", "postgresql://jupyter:jupyter-dev-password@localhost:5432/analysis_db")

# 顧客ごとの購買合計（ロイヤルティランクの判定材料）
df = pd.read_sql_query("""
    SELECT
        c.customer_id,
        c.customer_name,
        COALESCE(SUM(t.amount), 0) AS total_amount,
        COUNT(t.transaction_id) AS tx_count
    FROM customer_master c
    LEFT JOIN purchase_history t
        ON c.customer_id = t.customer_id
        AND t.status = 'completed'
    GROUP BY c.customer_id, c.customer_name
    ORDER BY total_amount DESC
    LIMIT 10
""", db_url)
print(f"rows={len(df)}")
print(f"columns={list(df.columns)}")
print(df.to_string(index=False))
`;
    const result = await executeCode(kernelId, code);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('rows=');
    expect(result.stdout).toContain('total_amount');
  });
});

// ========================================================================
// シナリオ 3: ロジック再利用→実行
// ========================================================================

describe('シナリオ 3: ロジック再利用→実行', () => {
  it('ロジックのメタ情報とコードを取得できる', async () => {
    if (!servicesAvailable) return;

    // ロジック一覧
    const index = await getLogicIndex();
    expect(index.total).toBeGreaterThanOrEqual(1);

    const logicNames = index.logic.map((l) => l.logic_name);
    expect(logicNames).toContain('sales_basic_aggregation');

    // メタ情報
    const meta = await getLogicDetail(['sales_basic_aggregation']);
    expect(meta.logic).toHaveLength(1);

    const logic = meta.logic[0];
    expect(logic.language).toBe('python');
    expect(logic.input_tables).toContain('purchase_history');

    // コード取得
    const code = await getLogicCode('sales_basic_aggregation');
    expect(code.logic_name).toBe('sales_basic_aggregation');
    expect(code.language).toBe('python');
    expect(code.code).toContain('def aggregate_sales');
  });

  it('取得したロジックコードをテスト用データで実行できる', async () => {
    if (!servicesAvailable) return;

    // ロジックコードを取得
    const logicCode = await getLogicCode('sales_basic_aggregation');

    // Jupyter で実行
    const { kernelId } = await setupJupyterEnv('scenario3-logic');

    // テスト用 DataFrame を作成してロジックを実行
    const code = `
import pandas as pd

# テスト用データ
df_transactions = pd.DataFrame({
    "customer_id": ["MB00010001", "MB00010001", "MB00010002", "MB00010002"],
    "store_code": ["ST001", "ST001", "ST002", "ST002"],
    "amount": [1000, 2000, 3000, 4000],
})
df_customers = pd.DataFrame({
    "customer_id": ["MB00010001", "MB00010002"],
    "loyalty_rank": ["ゴールド", "シルバー"],
})

# ロジックコードを定義
${logicCode.code}

# 実行
result = aggregate_sales(df_transactions, df_customers)
print(f"rows={len(result)}")
print(f"columns={list(result.columns)}")
print(result.to_string(index=False))
`;
    const result = await executeCode(kernelId, code);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('rows=');
    expect(result.stdout).toContain('total_amount');
    expect(result.stdout).toContain('customer_count');
  });
});

// ========================================================================
// シナリオ 4: 完全統合フロー（メイン E2E）
// ========================================================================

describe('シナリオ 4: 完全統合フロー', () => {
  it('用語解決→テーブル特定→ロジック参照→Jupyter実行の完全フローが成功する', async () => {
    if (!servicesAvailable) return;

    // Phase 1: 用語解決
    const termIndex = await getTermIndex();
    expect(termIndex.total).toBeGreaterThanOrEqual(1);

    const termDetail = await getTermDetail(['ロイヤルティランク']);
    expect(termDetail.terms).toHaveLength(1);
    expect(termDetail.terms[0].definition).toBeTruthy();

    // Phase 2: テーブル特定
    const tableIndex = await getTableIndex();
    expect(tableIndex.total).toBeGreaterThanOrEqual(2);

    const tableDetail = await getTableDetail(['purchase_history', 'customer_master']);
    expect(tableDetail.tables).toHaveLength(2);

    // カラム情報の確認
    const txTable = tableDetail.tables.find((t) => t.table_name === 'purchase_history');
    const custTable = tableDetail.tables.find((t) => t.table_name === 'customer_master');
    expect(txTable).toBeDefined();
    expect(custTable).toBeDefined();
    expect(txTable!.columns.length).toBeGreaterThan(0);
    expect(custTable!.columns.length).toBeGreaterThan(0);

    // Phase 3: ロジック参照
    const logicIndex = await getLogicIndex();
    expect(logicIndex.total).toBeGreaterThanOrEqual(1);

    const logicDetail = await getLogicDetail(['sales_basic_aggregation']);
    expect(logicDetail.logic).toHaveLength(1);
    expect(logicDetail.logic[0].language).toBe('python');

    const logicCode = await getLogicCode('sales_basic_aggregation');
    expect(logicCode.code).toContain('def aggregate_sales');

    // Phase 4: Jupyter 実行
    const { kernelId } = await setupJupyterEnv('scenario4-full');

    // テスト用 DataFrame + ロジックコードで実行
    const code = `
import pandas as pd

# テスト用データ（カタログのカラム定義に基づく）
df_transactions = pd.DataFrame({
    "customer_id": ["MB00010001", "MB00010002", "MB00010003", "MB00010001"],
    "store_code": ["ST001", "ST002", "ST001", "ST002"],
    "amount": [5000, 3000, 8000, 2000],
})
df_customers = pd.DataFrame({
    "customer_id": ["MB00010001", "MB00010002", "MB00010003"],
    "loyalty_rank": ["プラチナ", "ゴールド", "シルバー"],
})

# ロジックコード
${logicCode.code}

# 実行
result = aggregate_sales(df_transactions, df_customers)

# 結果検証出力
print(f"success=True")
print(f"rows={len(result)}")
print(f"columns={list(result.columns)}")
print(result.to_string(index=False))
`;
    const execResult = await executeCode(kernelId, code, 60);
    expect(execResult.success).toBe(true);
    expect(execResult.stdout).toContain('success=True');
    expect(execResult.stdout).toContain('total_amount');

    // 変数情報の確認
    const varCheckCode = `
print(f"result_type={type(result).__name__}")
print(f"result_shape={result.shape}")
`;
    const varResult = await executeCode(kernelId, varCheckCode);
    expect(varResult.success).toBe(true);
    expect(varResult.stdout).toContain('result_type=DataFrame');
  }, 120_000);
});

// ========================================================================
// シナリオ 5: エラーハンドリング
// ========================================================================

describe('シナリオ 5: エラーハンドリング', () => {
  it('存在しないテーブル/用語/ロジックの指定で not_found が返る', async () => {
    if (!servicesAvailable) return;

    // 存在しないテーブル
    const tableResult = await getTableDetail(['nonexistent_table']);
    expect(tableResult.tables).toHaveLength(0);
    expect(tableResult.not_found).toContain('nonexistent_table');

    // 存在しない用語
    const termResult = await getTermDetail(['存在しない用語']);
    expect(termResult.terms).toHaveLength(0);
    expect(termResult.not_found).toContain('存在しない用語');

    // 存在しないロジック
    const logicResult = await getLogicDetail(['nonexistent_logic']);
    expect(logicResult.logic).toHaveLength(0);
    expect(logicResult.not_found).toContain('nonexistent_logic');
  });

  it('存在するものと存在しないものの混在で部分成功が返る', async () => {
    if (!servicesAvailable) return;

    // テーブル: 1つ成功 + 1つ不明
    const tableResult = await getTableDetail(['purchase_history', 'nonexistent_table']);
    expect(tableResult.tables).toHaveLength(1);
    expect(tableResult.tables[0].table_name).toBe('purchase_history');
    expect(tableResult.not_found).toContain('nonexistent_table');

    // 用語: 1つ成功 + 1つ不明
    const termResult = await getTermDetail(['ロイヤルティランク', '存在しない用語']);
    expect(termResult.terms).toHaveLength(1);
    expect(termResult.terms[0].name).toBe('ロイヤルティランク');
    expect(termResult.not_found).toContain('存在しない用語');

    // ロジック: 1つ成功 + 1つ不明
    const logicResult = await getLogicDetail(['sales_basic_aggregation', 'nonexistent_logic']);
    expect(logicResult.logic).toHaveLength(1);
    expect(logicResult.logic[0].logic_name).toBe('sales_basic_aggregation');
    expect(logicResult.not_found).toContain('nonexistent_logic');
  });

  it('不正な Python コードの実行でエラー情報が返る', async () => {
    if (!servicesAvailable) return;

    const { kernelId } = await setupJupyterEnv('scenario5-error');

    // 構文エラー — サーバーのコードバリデーションで HTTP 400 CODE_NOT_ALLOWED として拒否される
    await expect(executeCode(kernelId, 'def foo(')).rejects.toThrow(/HTTP 400/);

    // 実行時エラー
    const runtimeResult = await executeCode(kernelId, '1 / 0');
    expect(runtimeResult.success).toBe(false);
    expect(runtimeResult.error).not.toBeNull();
    expect(runtimeResult.error!.type).toBe('ZeroDivisionError');
  });

  it('存在しないロジックコードの取得でエラーが返る', async () => {
    if (!servicesAvailable) return;

    // /logic/code/{name} は単一取得なのでエラーレスポンスになる
    try {
      await getLogicCode('nonexistent_logic');
      // ここに到達したらテスト失敗
      expect.unreachable('エラーが発生するはず');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).toContain('HTTP');
    }
  });
});
