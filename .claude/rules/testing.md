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

```bash
# TypeScript
npm test                 # 全テスト実行
npm test -- --watch      # ウォッチモード
npm test -- --coverage   # カバレッジレポート

# Python
pytest                   # 全テスト実行
pytest -v                # 詳細表示
pytest --cov=src         # カバレッジレポート
```

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
