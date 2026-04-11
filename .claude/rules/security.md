---
paths:
  - "jupyter-server/**/*"
  - "jupyter-mcp/**/*"
  - "document-server/**/*"
  - "document-mcp/**/*"
---

# セキュリティルール

全コンポーネントの実装時に適用されるセキュリティルール。

## 1. 認証・認可

- すべての API エンドポイントで認証を必須にする
- トークンは `Authorization: Bearer {token}` ヘッダーで受け取る
- 無効トークンには 401 を返し、操作ごとに認可を確認して他ユーザーのリソースへのアクセスを防ぐ

```typescript
// Good
if (!request.headers.authorization) {
  throw new UnauthorizedError('認証トークンが必要です');
}
const token = request.headers.authorization.replace('Bearer ', '');
if (!isValidToken(token)) {
  throw new UnauthorizedError('無効なトークンです');
}

// Bad: トークン検証なしで処理を続行
```

## 2. 入力検証

- ユーザー入力は信頼しない。型・長さ・形式を Pydantic（Python）/ Zod（TypeScript）で検証する
- SQL は必ずパラメータ化クエリ。文字列結合で組み立てない
- ファイルパスにユーザー入力を使う場合は正規化して base ディレクトリ配下に収まるか確認する

```python
# Good
from pydantic import BaseModel, Field, validator

class ExecuteRequest(BaseModel):
    code: str = Field(..., max_length=10000)
    timeout: int = Field(default=30, ge=1, le=300)

    @validator('code')
    def code_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('コードが空です')
        return v

# Good: SQL はパラメータ化
cursor.execute("SELECT * FROM tables WHERE name = %s", (table_name,))

# Good: パストラバーサル対策
def safe_path(base_dir: str, user_input: str) -> Path:
    base = Path(base_dir).resolve()
    target = (base / user_input).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError('不正なパスです')
    return target

# Bad
cursor.execute(f"SELECT * FROM tables WHERE name = '{table_name}'")
path = f"/data/{user_input}"  # ../../../etc/passwd が可能
```

## 3. 機密情報の管理

- パスワード・トークン・API キーはハードコードせず環境変数から取得する
- ログ・エラーメッセージに機密情報を出力しない
- API レスポンスに含めない（パスワードフィールドは `***` でマスク）

```typescript
// Good
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) throw new Error('DB_PASSWORD 環境変数が設定されていません');

// Good: レスポンスでマスク
// { "connection": { "host": "db.example.com", "user": "analyst", "password": "***" } }

// Bad
const dbPassword = 'secret123';
logger.info(`トークン ${token} で認証しました`);
```

## 4. コード実行の安全性（Jupyter 固有）

- コード実行には必ずタイムアウトを設定する（無限ループ防止）
- メモリ使用量と同時実行数を制限する
- ファイルシステム・ネットワークへのアクセスを必要最小限に制限する

```python
# Good
result = kernel.execute(code, timeout=30)

# Bad
result = kernel.execute(code)  # タイムアウトなし
```

## 5. 依存関係の管理

- `npm audit` / `pip-audit` で既知の脆弱性を定期的にチェックする
- 依存関係は定期更新し、セキュリティアップデートは優先的に適用する

## 6. エラーハンドリング

本番環境では内部エラーの詳細やスタックトレースを外部に公開しない。

```python
# Good
@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    logger.error(f"内部エラー: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "内部エラーが発生しました"}}
    )

# Bad: traceback や exc 文字列をそのままレスポンスに含める
```
