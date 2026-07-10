## E2E テスト

### 構成

```
tests/e2e/
├── vitest.config.ts                # testTimeout: 60000, concurrent: false
├── helpers/
│   └── api-client.ts               # REST API ラッパー（fetch ベース、外部ライブラリ非依存）
├── e2e-workflow.test.ts             # 業務シナリオの完全フロー検証
└── performance.test.ts              # API 応答時間テスト（NF1: 200ms 以内）
```

E2E テストは docker compose で起動した全サービスに対して実行する。

### テスト実行コマンド

```bash
# 前提: 全サービス起動
docker compose up -d

# E2E テスト実行
cd tests/e2e
npx vitest --config vitest.config.ts
```

### API クライアントヘルパー

`tests/e2e/helpers/api-client.ts` は Node.js の `fetch` API のみを使い、外部ライブラリに依存しない。サーバー側パッケージの型定義とも独立した E2E 専用の型定義を持つ。

```typescript
// 設定（環境変数から読み込み）
const DOCUMENT_SERVER_URL = process.env.DOCUMENT_SERVER_URL || 'http://localhost:3002';
const JUPYTER_SERVER_URL = process.env.JUPYTER_SERVER_URL || 'http://localhost:8888';
const JUPYTER_TOKEN = process.env.JUPYTER_TOKEN || '';
const DEFAULT_TIMEOUT_MS = 10_000;

// 共通ベース関数
async function baseFetch(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  options?: RequestInit,
  checkStatus = true,
): Promise<Response> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
    signal: options?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (checkStatus && !res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`);
  }
  return res;
}

// サービス起動確認
export async function checkServices(): Promise<{ document: boolean; jupyter: boolean }> {
  const healthCheck = (url: string, headers?: Record<string, string>) =>
    fetch(`${url}/health`, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    })
      .then((r) => r.ok)
      .catch(() => false);

  const [documentOk, jupyterOk] = await Promise.all([
    healthCheck(DOCUMENT_SERVER_URL),
    healthCheck(JUPYTER_SERVER_URL, JUPYTER_HEADERS),
  ]);
  return { document: documentOk, jupyter: jupyterOk };
}

// 各 API は docFetch / jupyterFetch でラップ
export async function getTableIndex() { /* ... */ }
export async function getTableDetail(tableNames: string[]) { /* ... */ }
export async function createWorkspace(name: string) { /* ... */ }
export async function createSession(workspaceId: string) { /* ... */ }
export async function executeCode(kernelId: string, code: string, timeout?: number) { /* ... */ }
export async function deleteSession(sessionId: string) { /* ... */ }
export async function deleteWorkspace(workspaceId: string) { /* ... */ }
```

### E2E テストパターン

#### サービス起動確認 + 条件付きスキップ

```typescript
let servicesAvailable = false;

beforeAll(async () => {
  const status = await checkServices();
  servicesAvailable = status.document && status.jupyter;
  if (!servicesAvailable) {
    console.warn('サービスに接続できません。E2E テストをスキップします。');
  }
});

it('テストケース', async () => {
  if (!servicesAvailable) return;
  // テスト本体
});
```

#### リソースクリーンアップ

```typescript
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
```

#### セットアップヘルパー

```typescript
async function setupJupyterEnv(testName: string) {
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
```

#### シナリオベースのテスト

E2E テストは業務シナリオに基づいた `describe` ブロックで構成する。

```typescript
describe('シナリオ 1: カタログ駆動の SQL 分析', () => {
  it('テーブルカタログからカラム情報を取得できる', async () => {
    if (!servicesAvailable) return;

    const index = await getTableIndex();
    expect(index.total).toBeGreaterThanOrEqual(2);

    const detail = await getTableDetail(['id_pos_transactions']);
    expect(detail.tables).toHaveLength(1);
    expect(detail.tables[0].columns.length).toBeGreaterThan(0);
  });

  it('カタログ情報を使って Jupyter でコードを実行できる', async () => {
    if (!servicesAvailable) return;

    const { kernelId } = await setupJupyterEnv('scenario1');
    const result = await executeCode(kernelId, 'print("hello")');
    expect(result.success).toBe(true);
    expect(result.stdout).toContain('hello');
  });
});
```

#### パフォーマンステスト

```typescript
const THRESHOLD_MS = 200;
const WARMUP_RUNS = 1;
const MEASURE_RUNS = 4;

async function measureEndpoint(
  name: string,
  fn: () => Promise<unknown>,
  thresholdMs: number,
): Promise<void> {
  // ウォームアップ
  for (let i = 0; i < WARMUP_RUNS; i++) await fn();

  // 計測
  const times: number[] = [];
  for (let i = 0; i < MEASURE_RUNS; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }

  // 全回が閾値以内であることを検証
  for (let i = 0; i < times.length; i++) {
    expect(times[i], `${name} の ${i + 1} 回目: ${times[i].toFixed(1)}ms`).toBeLessThan(thresholdMs);
  }
}

it('GET /catalog/index が 200ms 以内で応答する', async () => {
  await measureEndpoint('GET /catalog/index', () => getTableIndex(), THRESHOLD_MS);
});
```
