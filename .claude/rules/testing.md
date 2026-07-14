---
paths:
  - "**/tests/**/*"
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/test_*.py"
  - "**/*_test.py"
---

# テストルール

テストコードに適用されるルール。

## テスト方針

- ユニットテストで主要ロジックを、結合テストで API エンドポイントを、E2E テストで主要ユースケースをカバーする
- 対象: jupyter-mcp / document-mcp（各 MCP ツールの動作）、jupyter-server（カーネル管理、コード実行）、document-server（API、検索機能）

## テスト命名規約

TypeScript は `describe` + `it('should ...')`、Python は `Test{名前}` クラス + `test_{振る舞い}` メソッドで記述する。

```typescript
describe('session_create', () => {
  it('should create a new session and return session_id', async () => { /* ... */ });
  it('should throw error when jupyter-server is unavailable', async () => { /* ... */ });
});
```

```python
class TestTableAPI:
    def test_get_table_returns_table_details(self, client, sample_catalog): ...
    def test_get_table_returns_404_for_unknown_table(self, client): ...
```

## テスト構成

Arrange-Act-Assert パターンで書く。

```typescript
it('should execute code and return result', async () => {
  // Arrange
  const session = await createSession();
  const code = 'print("hello")';

  // Act
  const result = await executeCode(session.id, code);

  // Assert
  expect(result.success).toBe(true);
  expect(result.stdout).toBe('hello\n');
});
```

### モック

外部依存（API、DB）はモックする。モックは振る舞いレベルに留め、実装詳細に依存しない。

```typescript
// Good: 振る舞いをモック
jest.spyOn(jupyterClient, 'execute').mockResolvedValue({ success: true, stdout: 'hello\n' });

// Bad: 内部実装をモック
jest.spyOn(axios, 'post').mockResolvedValue({ data: { /* ... */ } });
```

## エッジケース

必ず以下をテストする:

- 正常系: 基本成功パターン、オプションパラメータあり/なし
- 異常系: バリデーションエラー、存在しないリソース、タイムアウト、接続エラー
- 境界値: 空配列・空文字列、最大値・最小値、null / undefined

## テスト実行

`scripts/test.sh` を使う（`.claude/rules/scripts.md` 参照）。`npm test` / `pytest` の直接実行は禁止。

### フルゲート実行時の統合テスト検出

タスク完了・リファクタリング等でフルゲートテストを実行する際、統合テストの実行要否を以下で判定する:

1. `git status` の変更・未追跡ファイルに `tests/integration/` 配下が含まれるか確認する
2. 含まれる場合、そのパスからコンポーネントを判定し `scripts/test.sh --quiet --integration --rebuild {コンポーネント名}` も実行する
3. 計画の完了条件に統合テスト（`--integration`）が明記されている場合も同様に実行する

| パス | コンポーネント |
|------|---------------|
| `jupyter-mcp/tests/integration/` | jupyter-mcp |
| `document-mcp/tests/integration/` | document-mcp |
| `tests/e2e/` | e2e |

## ブラウザ動作確認（playwright-cli）

動作確認や結合テストでブラウザ操作が必要な場合は、`@playwright/cli` で自律的に操作すること。セットアップ・コマンド一覧・JupyterLab のトークン認証の扱いは [`docs/guides/browser-automation.md`](../../docs/guides/browser-automation.md) を参照する。

### ブラウザ確認が必要／不要なケース

| 必要 | 不要 |
|------|------|
| UI の表示・レイアウト確認 | 純粋なバックエンドロジック（API レスポンス検証で十分） |
| ユーザー操作を伴う機能（クリック、フォーム入力、D&D） | ユニットテストで検証できる範囲 |
| リアルタイム同期（AI 側の操作が JupyterLab に即時反映されるか） | CLI ツールやスクリプトの動作 |
| WebSocket 通信の結果確認、エラー表示、画面遷移 | |

事前に `docker compose ps` で必要サービスの起動を確認する。JupyterLab は `http://localhost:8888`。

## セキュリティテスト

認証・入力検証・機密情報・タイムアウトについて、要件を満たすことを確認するテストを必ず作成する。

### 認証・認可

```typescript
describe('認証', () => {
  it('トークンなしのリクエストは401を返す', async () => {
    const response = await request(app).get('/api/kernels');
    expect(response.status).toBe(401);
  });
});
```

他ユーザーのリソースアクセス時に 403、無効トークンで 401 も同様にテストする。

### 入力検証

```typescript
it('SQLインジェクションを含む入力は適切に処理される', async () => {
  const response = await request(app)
    .get('/api/v1/tables')
    .query({ tag: "'; DROP TABLE tables; --" })
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
});
```

空入力、範囲外パラメータ、パストラバーサル（`../../../etc/passwd` が 400）も同様に検証する。

### 機密情報

```typescript
it('レスポンスにパスワードが平文で含まれない', async () => {
  const response = await request(app)
    .get('/api/v1/tables/sales/connection')
    .set('Authorization', `Bearer ${token}`);
  expect(response.body.data.connection.password).toBe('***');
});
```

エラーレスポンスに `traceback` / `stack` が含まれないことも検証する。

### タイムアウト

```typescript
it('無限ループはタイムアウトする', async () => {
  const response = await request(app)
    .post('/api/kernels/123/execute')
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'while True: pass', timeout: 1 });
  expect(response.body.data.success).toBe(false);
  expect(response.body.data.error.type).toBe('TimeoutError');
});
```

### セキュリティテストのチェックリスト

- [ ] 認証なしアクセスが拒否されるか
- [ ] 無効なトークンが拒否されるか
- [ ] 他ユーザーのリソースにアクセスできないか
- [ ] 不正な入力が適切に拒否されるか
- [ ] SQLインジェクションが防がれているか
- [ ] パストラバーサルが防がれているか
- [ ] 機密情報がレスポンスに含まれないか
- [ ] エラー時に内部情報が漏れないか
- [ ] タイムアウトが機能するか
