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

### APIトークンの検証

- すべてのAPIエンドポイントで認証を必須とする
- トークンは `Authorization: Bearer {token}` ヘッダーで受け取る
- 無効なトークンには 401 Unauthorized を返す

```typescript
// Good
if (!request.headers.authorization) {
  throw new UnauthorizedError('認証トークンが必要です');
}
const token = request.headers.authorization.replace('Bearer ', '');
if (!isValidToken(token)) {
  throw new UnauthorizedError('無効なトークンです');
}

// Bad
// トークン検証なしで処理を続行
```

### 認可の確認

- 操作ごとに権限を確認する
- 他ユーザーのリソースにアクセスできないようにする

## 2. 入力検証

### すべての入力を検証する

- ユーザーからの入力は信頼しない
- 型、長さ、形式を検証する
- 検証には Pydantic（Python）/ Zod（TypeScript）を使用する

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

# Bad
def execute(code, timeout):
    # 検証なしで実行
    kernel.execute(code)
```

### SQLインジェクション対策

- SQLクエリには必ずパラメータ化クエリを使用する
- 文字列結合でSQLを組み立てない

```python
# Good
cursor.execute(
    "SELECT * FROM tables WHERE name = %s",
    (table_name,)
)

# Bad - SQLインジェクションの脆弱性
cursor.execute(f"SELECT * FROM tables WHERE name = '{table_name}'")
```

### パストラバーサル対策

- ファイルパスにユーザー入力を使用する場合は正規化・検証する

```python
# Good
import os
from pathlib import Path

def safe_path(base_dir: str, user_input: str) -> Path:
    base = Path(base_dir).resolve()
    target = (base / user_input).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError('不正なパスです')
    return target

# Bad
path = f"/data/{user_input}"  # ../../../etc/passwd などが可能
```

## 3. 機密情報の管理

### 環境変数で管理

- パスワード、トークン、APIキーはコードにハードコードしない
- 環境変数から取得する

```typescript
// Good
const dbPassword = process.env.DB_PASSWORD;
if (!dbPassword) {
  throw new Error('DB_PASSWORD 環境変数が設定されていません');
}

// Bad
const dbPassword = 'secret123';
```

### ログに出力しない

- 機密情報をログに出力しない
- エラーメッセージに機密情報を含めない

```python
# Good
logger.info(f"ユーザー {user_id} が接続しました")
logger.error(f"認証エラー: ユーザー {user_id}")

# Bad
logger.info(f"トークン {token} で認証しました")
logger.error(f"DB接続エラー: password={password}")
```

### レスポンスに含めない

- APIレスポンスに機密情報を含めない
- パスワードフィールドは `***` でマスクする

```python
# Good
{
    "connection": {
        "host": "db.example.com",
        "user": "analyst",
        "password": "***"
    }
}

# Bad
{
    "connection": {
        "host": "db.example.com",
        "user": "analyst",
        "password": "actual_password_here"
    }
}
```

## 4. コード実行の安全性（Jupyter固有）

### タイムアウトの設定

- コード実行には必ずタイムアウトを設定する
- 無限ループを防ぐ

```python
# Good
result = kernel.execute(code, timeout=30)

# Bad
result = kernel.execute(code)  # タイムアウトなし
```

### リソース制限

- メモリ使用量を制限する
- 同時実行数を制限する

### 危険な操作の制限

- ファイルシステムへのアクセスを制限する
- ネットワークアクセスを制限する（必要に応じて）

## 5. 依存関係の管理

### 既知の脆弱性のチェック

```bash
# npm
npm audit

# pip
pip-audit
```

### 依存関係の更新

- 定期的に依存関係を更新する
- セキュリティアップデートは優先的に適用する

## 6. エラーハンドリング

### 詳細なエラー情報を隠す

- 本番環境では内部エラーの詳細を返さない
- スタックトレースを外部に公開しない

```python
# Good
@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    logger.error(f"内部エラー: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "INTERNAL_ERROR", "message": "内部エラーが発生しました"}}
    )

# Bad
@app.exception_handler(Exception)
async def generic_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "traceback": traceback.format_exc()}
    )
```
