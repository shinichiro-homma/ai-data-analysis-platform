---
paths:
  - "document-server/**/*"
  - "jupyter-server/**/*"
---

# Python ルール

document-server、jupyter-server に適用されるルール。

## コーディング規約

### フォーマット

- Black でフォーマットする（行長 88 文字）
- isort でインポートを整理する

### 型ヒント

- 関数の引数・戻り値には型ヒントを付ける
- Pydantic モデルを積極的に使用する

```python
# Good
from pydantic import BaseModel

class TableSummary(BaseModel):
    name: str
    display_name: str
    description: str
    tags: list[str]
    row_count: int | None = None

def get_table(name: str) -> Table | None:
    ...

# Bad
def get_table(name):
    ...
```

### インポート順序

1. 標準ライブラリ
2. サードパーティ
3. ローカル

```python
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .models import Table
from .catalog_loader import load_catalog
```

## FastAPI 実装

### ルーター構成

- 機能ごとにルーターを分割する（`routers/tables.py`, `routers/search.py`）
- プレフィックスは `/api/v1` を使用する

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/tables", tags=["tables"])

@router.get("/{name}")
async def get_table(name: str) -> TableResponse:
    ...
```

### レスポンス形式

- 成功時は `{"data": ...}` 形式で返す
- エラー時は HTTPException を使用する

```python
from fastapi import HTTPException

@router.get("/{name}")
async def get_table(name: str) -> dict:
    table = catalog.get(name)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return {"data": table}
```

### バリデーション

- リクエストボディは Pydantic モデルで定義する
- クエリパラメータにもデフォルト値・制約を設定する

```python
@router.get("/")
async def list_tables(
    tag: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict:
    ...
```

## テスト

- pytest を使用する
- FastAPI の TestClient で API テストを行う
- フィクスチャでテストデータを準備する

```python
from fastapi.testclient import TestClient

def test_get_table(client: TestClient, sample_catalog):
    response = client.get("/api/v1/tables/sales_transactions")
    assert response.status_code == 200
    assert response.json()["data"]["name"] == "sales_transactions"
```
