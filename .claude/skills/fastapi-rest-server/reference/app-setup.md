## プロジェクト構成

```
document-server/
├── src/
│   ├── main.py           # FastAPI アプリケーション（lifespan, CORS, ルーター登録）
│   ├── config.py         # 環境変数からの設定読み込み
│   ├── models.py         # Pydantic モデル（リクエスト/レスポンス）
│   ├── responses.py      # レスポンスヘルパー関数
│   ├── dependencies.py   # 依存性注入
│   ├── catalog_loader.py # データローダー（YAML -> インメモリストア）
│   └── routers/
│       ├── __init__.py
│       ├── tables.py     # テーブル API（/catalog/*）
│       ├── terms.py      # 用語集 API（/glossary/*）
│       ├── logic.py      # ロジック API（/logic/*）
│       └── admin.py      # 管理 API（/admin/*）
├── data/                 # YAML データファイル
│   ├── catalog/
│   │   ├── index.yaml
│   │   └── tables/*.yaml
│   ├── glossary/
│   │   ├── index.yaml
│   │   └── terms/*.yaml
│   └── logic/
│       ├── index.yaml
│       ├── meta/*.yaml
│       └── code/{sql,python}/*
├── tests/
│   ├── __init__.py
│   ├── conftest.py       # 共通フィクスチャ（テストデータ, TestClient）
│   ├── test_tables_api.py
│   ├── test_terms_api.py
│   ├── test_logic_api.py
│   ├── test_health.py
│   ├── test_catalog_loader.py
│   └── test_models.py
├── Dockerfile
├── pyproject.toml
└── requirements.txt
```

## 設定ファイル

### config.py

環境変数を読み込み、型付きの設定値として公開する。

```python
import os
from pathlib import Path

DATA_DIR: Path = Path(os.environ.get("DATA_DIR", "./data")).resolve()
PORT: int = int(os.environ.get("PORT", "3002"))
CORS_ORIGINS: list[str] = os.environ.get("CORS_ORIGINS", "http://localhost:8888").split(",")
```

### pyproject.toml

```toml
[project]
name = "document-server"
version = "0.1.0"
description = "データカタログ・用語集管理APIサーバー"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "pyyaml>=6.0",
    "pydantic>=2.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

## FastAPI アプリケーション設定

### main.py のパターン

```python
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .catalog_loader import CatalogStore
from .config import CORS_ORIGINS, DATA_DIR
from .routers import admin, logic, tables, terms

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # 起動時: データをインメモリストアにロード
    store = CatalogStore()
    try:
        store.load_all(DATA_DIR)
    except (ValueError, OSError) as exc:
        logger.error("Failed to load catalog on startup: %s", exc)
        raise RuntimeError(f"Catalog load failed: {exc}") from exc
    app.state.catalog_store = store
    app.state.last_reload = datetime.now(timezone.utc).isoformat()
    logger.info(
        "Catalog loaded: %d tables, %d terms, %d logic",
        store.table_count, store.term_count, store.logic_count,
    )
    yield
    # シャットダウン時の処理が必要ならここに記述


app = FastAPI(title="document-server", version="1.0.0", lifespan=lifespan)

# CORS 設定
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# ルーター登録
app.include_router(tables.router)
app.include_router(terms.router)
app.include_router(logic.router)
app.include_router(admin.router)


# ヘルスチェック（ルーターに属さないグローバルエンドポイント）
@app.get("/health")
def health() -> dict:
    store: CatalogStore = app.state.catalog_store
    return {
        "status": "healthy",
        "version": app.version,
        "catalog": {
            "tables": store.table_count,
            "terms": store.term_count,
            "logic": store.logic_count,
            "last_reload": app.state.last_reload,
        },
    }
```

### ポイント

- `lifespan` コンテキストマネージャでアプリの起動/シャットダウン処理を管理
- データストアは `app.state` に格納し、依存性注入経由でルーターから参照
- CORS の `allow_methods` は実際に使うメソッドのみに絞る
- ヘルスチェックはルーターに属さずアプリ直接に定義

## レスポンスヘルパー

### responses.py

全エンドポイントで統一したレスポンス形式を保つためのヘルパー関数群。

```python
from __future__ import annotations

from fastapi.responses import JSONResponse


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """統一的なエラーレスポンスを生成する。"""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def index_response(key: str, items: list[dict]) -> dict:
    """インデックス一覧レスポンスを生成する。"""
    return {"data": {key: items, "total": len(items)}}


def detail_response(key: str, items: list[dict], not_found: list[str]) -> dict:
    """詳細一括取得レスポンスを生成する。"""
    return {"data": {key: items, "not_found": not_found}}
```

### レスポンス形式

**成功時（インデックス）:**
```json
{ "data": { "<key>": [...], "total": 3 } }
```

**成功時（詳細一括取得）:**
```json
{ "data": { "<key>": [...], "not_found": ["missing_item"] } }
```

**エラー時:**
```json
{ "error": { "code": "ERROR_CODE", "message": "エラーメッセージ" } }
```

## Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 依存関係のインストール（ランタイムのみ）
COPY document-server/requirements.txt .
RUN pip install --no-cache-dir fastapi uvicorn[standard] pyyaml pydantic

# アプリケーションコードの配置
COPY document-server/src ./src
COPY document-server/data ./data

# ヘルスチェック用にcurlをインストール
RUN apt-get update && apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

EXPOSE 3002

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "3002"]
```
