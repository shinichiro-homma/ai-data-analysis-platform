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

### カバレッジ目標

- ユニットテスト: 主要なロジックをカバー
- 結合テスト: API エンドポイントをカバー
- E2E テスト: 主要なユースケースをカバー

### テスト対象

| コンポーネント | テスト内容 |
|---------------|-----------|
| jupyter-mcp | 各MCPツールの動作 |
| document-mcp | 各MCPツールの動作 |
| jupyter-server | カーネル管理、コード実行 |
| document-server | API エンドポイント、検索機能 |

## テスト命名規約

### TypeScript

```typescript
describe('session_create', () => {
  it('should create a new session and return session_id', async () => {
    // ...
  });

  it('should throw error when jupyter-server is unavailable', async () => {
    // ...
  });
});
```

### Python

```python
class TestTableAPI:
    def test_get_table_returns_table_details(self, client, sample_catalog):
        # ...

    def test_get_table_returns_404_for_unknown_table(self, client):
        # ...
```

## テスト構成

### Arrange-Act-Assert パターン

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

- 外部依存（API、DB）はモックする
- モックは最小限に（実装詳細に依存しない）

```typescript
// Good: 振る舞いをモック
jest.spyOn(jupyterClient, 'execute').mockResolvedValue({
  success: true,
  stdout: 'hello\n'
});

// Bad: 内部実装をモック
jest.spyOn(axios, 'post').mockResolvedValue({ data: { ... } });
```

## エッジケース

以下のケースを必ずテストする：

### 正常系
- 基本的な成功パターン
- オプションパラメータあり/なし

### 異常系
- バリデーションエラー
- 存在しないリソースへのアクセス
- タイムアウト
- 接続エラー

### 境界値
- 空配列、空文字列
- 最大値、最小値
- null、undefined

## テスト実行

テスト実行には `scripts/test.sh` を使用すること（`.claude/rules/scripts.md` 参照）。
`npm test` や `pytest` を直接実行してはならない。

## ブラウザ動作確認（Playwright MCP）

動作確認や結合テストでブラウザ操作が必要、もしくは推奨される場合は、Playwright MCP を使って自律的にブラウザを操作すること。

### ブラウザ確認が必要なケース

以下のいずれかに該当する場合は、Playwright MCP によるブラウザ確認を行う：

| ケース | 例 |
|--------|-----|
| UI の表示・レイアウト確認 | セルの追加が画面に反映されるか |
| ユーザー操作を伴う機能 | ボタンクリック、フォーム入力、ドラッグ&ドロップ |
| リアルタイム同期の確認 | AI 側の操作が JupyterLab に即時反映されるか |
| WebSocket 通信の結果確認 | イベント受信後の画面更新 |
| エラー表示の確認 | エラーメッセージが適切に表示されるか |
| 画面遷移の確認 | ページ遷移、モーダル表示 |

### ブラウザ確認が不要なケース

以下の場合はブラウザ確認を省略してよい：

- 純粋なバックエンドロジック（API レスポンスの検証で十分）
- ユニットテストで検証できる範囲
- CLI ツールやスクリプトの動作

### 基本的な操作手順

1. **ページアクセス:** `browser_navigate` で対象 URL にアクセスする
2. **状態確認:** `browser_snapshot` でアクセシビリティツリーを取得し、ページの状態を把握する
3. **操作:** `browser_click`、`browser_type`、`browser_fill_form` 等で必要な操作を行う
4. **結果確認:** `browser_snapshot` で操作結果を確認する
5. **エビデンス記録:** 必要に応じて `browser_take_screenshot` でスクリーンショットを保存する
6. **エラー確認:** `browser_console_messages` でコンソールエラーを確認する

### 注意事項

- ブラウザ確認の前に `docker-compose ps` で必要なサービスが起動しているか確認する
- JupyterLab は `http://localhost:8888` でアクセスする
- `browser_snapshot` はスクリーンショットより軽量で、要素の参照（ref）も取得できるため、操作が必要な場合は `browser_snapshot` を優先する
- 非同期処理の結果を待つ場合は `browser_wait_for` を使用する

## セキュリティテスト

セキュリティ要件を満たしていることを確認するテストを必ず作成する。

### 認証・認可のテスト

```typescript
describe('認証', () => {
  it('トークンなしのリクエストは401を返す', async () => {
    const response = await request(app).get('/api/kernels');
    expect(response.status).toBe(401);
  });

  it('無効なトークンは401を返す', async () => {
    const response = await request(app)
      .get('/api/kernels')
      .set('Authorization', 'Bearer invalid-token');
    expect(response.status).toBe(401);
  });

  it('他ユーザーのリソースにアクセスすると403を返す', async () => {
    const response = await request(app)
      .get('/api/kernels/other-user-kernel')
      .set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });
});
```

### 入力検証のテスト

```typescript
describe('入力検証', () => {
  it('空のコードは400を返す', async () => {
    const response = await request(app)
      .post('/api/kernels/123/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '' });
    expect(response.status).toBe(400);
  });

  it('タイムアウトが範囲外の場合は400を返す', async () => {
    const response = await request(app)
      .post('/api/kernels/123/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'print(1)', timeout: 9999 });
    expect(response.status).toBe(400);
  });

  it('SQLインジェクションを含む入力は適切に処理される', async () => {
    const response = await request(app)
      .get('/api/v1/tables')
      .query({ tag: "'; DROP TABLE tables; --" })
      .set('Authorization', `Bearer ${token}`);
    // エラーにならず、結果が0件または適切にエスケープされる
    expect(response.status).toBe(200);
  });

  it('パストラバーサルを含む入力は拒否される', async () => {
    const response = await request(app)
      .get('/api/contents/../../../etc/passwd')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(400);
  });
});
```

### 機密情報のテスト

```typescript
describe('機密情報', () => {
  it('レスポンスにパスワードが平文で含まれない', async () => {
    const response = await request(app)
      .get('/api/v1/tables/sales/connection')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data.connection.password).toBe('***');
  });

  it('エラーレスポンスにスタックトレースが含まれない', async () => {
    const response = await request(app)
      .get('/api/v1/tables/nonexistent')
      .set('Authorization', `Bearer ${token}`);
    expect(response.body.error.traceback).toBeUndefined();
    expect(response.body.error.stack).toBeUndefined();
  });
});
```

### タイムアウトのテスト

```typescript
describe('タイムアウト', () => {
  it('無限ループはタイムアウトする', async () => {
    const response = await request(app)
      .post('/api/kernels/123/execute')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'while True: pass', timeout: 1 });
    expect(response.body.data.success).toBe(false);
    expect(response.body.data.error.type).toBe('TimeoutError');
  });
});
```

### セキュリティテストのチェックリスト

テスト作成時に以下を確認する：

- [ ] 認証なしアクセスが拒否されるか
- [ ] 無効なトークンが拒否されるか
- [ ] 他ユーザーのリソースにアクセスできないか
- [ ] 不正な入力が適切に拒否されるか
- [ ] SQLインジェクションが防がれているか
- [ ] パストラバーサルが防がれているか
- [ ] 機密情報がレスポンスに含まれないか
- [ ] エラー時に内部情報が漏れないか
- [ ] タイムアウトが機能するか
