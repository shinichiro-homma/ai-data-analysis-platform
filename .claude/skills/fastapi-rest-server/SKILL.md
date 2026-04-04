# FastAPI REST Server

## 概要

Python FastAPI による REST API サーバーの実装パターン。document-server で確立されたパターンを基にする。

- インメモリデータストアへの起動時ロード
- インデックス（一覧）/ 詳細（一括取得）の2層 API 構成
- Pydantic モデルによるバリデーション
- レスポンスヘルパーによる統一レスポンス形式
- FastAPI の依存性注入（`Depends`）によるストアアクセス

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

## Router パターン

### 基本構造

各ルーターは `APIRouter` を使い、prefix と tags を設定する。

```python
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..catalog_loader import CatalogStore
from ..dependencies import get_catalog_store
from ..models import TableDetailRequest
from ..responses import detail_response, index_response

router = APIRouter(prefix="/catalog", tags=["catalog"])
```

### インデックスエンドポイント（GET）

一覧を返す軽量エンドポイント。`index_response()` でラップする。

```python
@router.get("/index")
def get_table_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    tables = [t.model_dump() for t in store.get_all_indexes()]
    return index_response("tables", tables)
```

**用語集の例:**
```python
@router.get("/index")
def get_term_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    terms = [t.model_dump() for t in store.get_all_term_indexes()]
    return index_response("terms", terms)
```

### 詳細エンドポイント（POST, 一括取得）

リクエストボディで名前リストを受け取り、found/not_found を返す。`detail_response()` でラップする。

```python
@router.post("/tables", response_model=None)
def get_table_details(
    request: TableDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    tables, not_found = store.get_table_details(request.table_names)
    return detail_response(
        "tables", [t.model_dump(by_alias=True) for t in tables], not_found
    )
```

**用語集の例:**
```python
@router.post("/terms", response_model=None)
def get_term_details(
    request: TermDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    terms, not_found = store.get_term_details(request.term_names)
    return detail_response("terms", [t.model_dump() for t in terms], not_found)
```

### 個別取得エンドポイント（GET + パスパラメータ）

パスパラメータにバリデーション（正規表現、最大長）を適用し、エラーケースを `error_response()` で処理する。

```python
from fastapi import Path as FastAPIPath
from fastapi.responses import JSONResponse

from ..catalog_loader import LogicCodeNotFoundError
from ..responses import error_response

@router.get("/code/{logic_name}", response_model=None)
def get_logic_code(
    logic_name: str = FastAPIPath(..., pattern=r"^[a-zA-Z0-9_-]+$", max_length=100),
    store: CatalogStore = Depends(get_catalog_store),
) -> dict | JSONResponse:
    try:
        result = store.get_logic_code(logic_name)
    except LogicCodeNotFoundError:
        return error_response(
            404, "LOGIC_CODE_NOT_FOUND",
            f"Code file for logic '{logic_name}' not found",
        )
    if result is None:
        return error_response(404, "LOGIC_NOT_FOUND", f"Logic '{logic_name}' not found")
    return {"data": result}
```

### 管理エンドポイント

リロードなどの管理操作。`Request` オブジェクトを直接受け取って `app.state` を更新する。

```python
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..catalog_loader import CatalogStore
from ..config import DATA_DIR
from ..dependencies import get_catalog_store
from ..responses import error_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/reload", response_model=None)
def reload_catalog(
    request: Request,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict | JSONResponse:
    start = time.monotonic()
    try:
        loaded = store.load_all(DATA_DIR)
    except (ValueError, OSError) as exc:
        logger.error("Catalog reload failed: %s", exc)
        return error_response(
            400, "CATALOG_LOAD_ERROR",
            "Failed to reload catalog. Check server logs for details."
        )
    except Exception as exc:
        logger.exception("Unexpected error during catalog reload")
        return error_response(500, "INTERNAL_ERROR", "Unexpected error during reload.")
    elapsed_ms = int((time.monotonic() - start) * 1000)
    request.app.state.last_reload = datetime.now(timezone.utc).isoformat()
    return {
        "data": {
            "status": "reloaded",
            "tables_loaded": loaded["tables"],
            "terms_loaded": loaded["terms"],
            "logic_loaded": loaded["logic"],
            "reload_time_ms": elapsed_ms,
        }
    }
```

## Pydantic モデル

### モデル定義のパターン

#### 共通バリデータ

文字列の前後空白を除去する共通バリデータを定義し、各モデルで再利用する。

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


def _strip_string(v: Any) -> Any:
    """文字列フィールドの前後空白を除去する共通バリデータ。"""
    if isinstance(v, str):
        return v.strip()
    return v
```

#### インデックスモデル（軽量な一覧用）

```python
class TableIndex(BaseModel):
    table_name: str
    display_name: str
    summary: str
    category: str


class TermIndex(BaseModel):
    name: str
    summary: str


class LogicIndex(BaseModel):
    logic_name: str
    summary: str
    category: str
```

#### 詳細モデル（全情報を含む）

ネストしたモデルと任意フィールドを活用する。`field_validator` で空白除去を適用。

```python
class TableDetail(BaseModel):
    table_name: str
    display_name: str
    description: str
    data_source: DataSource | None = None
    columns: list[ColumnInfo]
    statistics: Statistics | None = None
    notes_table_level: list[str] | None = None

    _strip_description = field_validator("description", mode="before")(_strip_string)


class TermDetail(BaseModel):
    name: str
    aliases: list[str]
    definition: str
    related_terms: list[str] | None = None
    values: list[TermValue] | None = None


class LogicMeta(BaseModel):
    logic_name: str
    description: str
    file_path: str
    language: str
    usage_type: str
    input_tables: list[str]
    output_description: str
    usage_context: str | None = None
    related_logic: list[str] | None = None
    notes: str | None = None

    @field_validator("file_path", mode="before")
    @classmethod
    def _validate_file_path(cls, v: Any) -> Any:
        """パストラバーサル防止: 相対パスのみ許可し '..' セグメントを拒否する。"""
        if isinstance(v, str) and (".." in v.split("/") or v.startswith("/")):
            raise ValueError(
                f"Invalid file_path: '{v}' must be a relative path without '..'"
            )
        return v

    _strip_description = field_validator("description", mode="before")(_strip_string)
    _strip_notes = field_validator("notes", mode="before")(_strip_string)
    _strip_output_description = field_validator("output_description", mode="before")(_strip_string)
    _strip_usage_context = field_validator("usage_context", mode="before")(_strip_string)
```

#### リクエストモデル（一括取得用）

`Field` で `min_length` / `max_length` を指定し、空リストや過大リクエストを拒否する。

```python
class TableDetailRequest(BaseModel):
    """テーブル詳細一括取得リクエスト"""
    table_names: list[str] = Field(..., min_length=1, max_length=100)


class TermDetailRequest(BaseModel):
    """用語詳細一括取得リクエスト"""
    term_names: list[str] = Field(..., min_length=1, max_length=100)


class LogicMetaRequest(BaseModel):
    """ロジックメタ一括取得リクエスト"""
    logic_names: list[str] = Field(..., min_length=1, max_length=100)
```

#### ドメイン/ネストモデル

Union 型は `|` 構文で表現する。

```python
class ColumnDomainMaster(BaseModel):
    """マスタ参照型ドメイン"""
    master_table: str
    master_column: str
    label_column: str


class ColumnDomainValues(BaseModel):
    """直接列挙型ドメイン"""
    values: list[str]


class ColumnInfo(BaseModel):
    name: str
    type: str
    description: str
    nullable: bool
    key_type: str | None = None
    domain: ColumnDomainMaster | ColumnDomainValues | None = None
    notes: str | None = None
    examples: list[str | int | float] | None = None

    _strip_notes = field_validator("notes", mode="before")(_strip_string)
```

#### エイリアス付きモデル

Pydantic v2 の `Field(alias=...)` と `model_config` を使う。

```python
class DateRange(BaseModel):
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    model_config = {"populate_by_name": True}
```

## 依存性注入

### dependencies.py

`app.state` からストアを取得する関数。ルーターの `Depends()` で使用する。

```python
from __future__ import annotations

from fastapi import Request

from .catalog_loader import CatalogStore


def get_catalog_store(request: Request) -> CatalogStore:
    """リクエストから CatalogStore を取得する依存関数。"""
    return request.app.state.catalog_store
```

### ルーターでの使用パターン

```python
from fastapi import Depends

from ..dependencies import get_catalog_store
from ..catalog_loader import CatalogStore

@router.get("/index")
def get_table_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    ...
```

## データローダー

### CatalogStore のパターン

`CatalogStore` はインメモリの辞書でデータを保持する。共通の `_load_resource()` メソッドでインデックスと詳細の読み込みを一般化する。

#### YAML 読み込みユーティリティ

```python
import yaml
from pathlib import Path
from typing import Any

def _load_yaml(yaml_path: Path) -> dict[str, Any] | list[Any] | None:
    """YAMLファイルを読み込み、パース結果を返す。"""
    try:
        with open(yaml_path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as exc:
        raise ValueError(
            f"YAML syntax error in {yaml_path.name}: {exc}"
        ) from exc


def _load_and_validate_yaml(
    yaml_path: Path, required_key: str
) -> dict[str, Any] | None:
    """YAMLを読み込み、辞書型かつ必須キーが存在するか検証する。"""
    data = _load_yaml(yaml_path)
    if not isinstance(data, dict) or required_key not in data:
        logger.warning(
            "Skipping %s: '%s' not defined", yaml_path.name, required_key
        )
        return None
    return data
```

#### ストアクラス

```python
class CatalogStore:
    """テーブルカタログと用語集をインメモリで保持するストア"""

    def __init__(self) -> None:
        self._indexes: dict[str, TableIndex] = {}
        self._details: dict[str, TableDetail] = {}
        self._term_indexes: dict[str, TermIndex] = {}
        self._term_details: dict[str, TermDetail] = {}
        self._logic_indexes: dict[str, LogicIndex] = {}
        self._logic_metas: dict[str, LogicMeta] = {}
        self._data_dir: Path | None = None

    @property
    def table_count(self) -> int:
        return len(self._indexes)

    @property
    def term_count(self) -> int:
        return len(self._term_indexes)

    @property
    def logic_count(self) -> int:
        return len(self._logic_indexes)
```

#### 一括検索ヘルパー（found / not_found 分離）

```python
    @staticmethod
    def _lookup_many(
        store: dict[str, _T], names: list[str]
    ) -> tuple[list[_T], list[str]]:
        """名前リストから辞書を引き、found/not_found に振り分ける。"""
        found: list[_T] = []
        not_found: list[str] = []
        for name in names:
            item = store.get(name)
            if item is not None:
                found.append(item)
            else:
                not_found.append(name)
        return found, not_found
```

#### リソース読み込みの共通処理

インデックスと詳細の読み込みロジックを一般化したメソッド。テーブル・用語・ロジックの全てで同じパターンを使う。

```python
    def _load_resource(
        self,
        data_dir: Path,
        sub_dir: str,
        detail_dir: str,
        index_key: str,
        id_field: str,
        parse_index: Callable[[dict[str, Any]], _T],
        parse_detail: Callable[[dict[str, Any]], _T],
        resource_label: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """インデックスと詳細を読み込む共通処理。"""
        base_dir = data_dir / sub_dir
        index_path = base_dir / "index.yaml"
        details_path = base_dir / detail_dir

        # インデックス読み込み
        indexes: dict[str, Any] = {}
        if index_path.is_file():
            data = _load_yaml(index_path)
            if isinstance(data, dict) and index_key in data:
                for raw in data[index_key]:
                    name = raw.get(id_field)
                    if name:
                        indexes[name] = parse_index(raw)

        # 詳細読み込み
        details: dict[str, Any] = {}
        if details_path.is_dir():
            for yaml_path in sorted(details_path.glob("*.yaml")):
                validated = _load_and_validate_yaml(yaml_path, id_field)
                if validated is None:
                    continue
                name = validated[id_field]
                details[name] = parse_detail(validated)

        # 整合性チェック: インデックスにあるが詳細がないものを警告
        for name in indexes:
            if name not in details:
                logger.warning(
                    "%s '%s' is in index but has no detail YAML",
                    resource_label.capitalize(), name
                )

        return indexes, details
```

#### リソース種別ごとの読み込みメソッド

```python
    def load_all(self, data_dir: Path) -> dict[str, int]:
        """全リソースを読み込む。"""
        return {
            "tables": self.load_tables(data_dir),
            "terms": self.load_terms(data_dir),
            "logic": self.load_logic(data_dir),
        }

    def load_tables(self, data_dir: Path) -> int:
        indexes, details = self._load_resource(
            data_dir=data_dir,
            sub_dir="catalog",
            detail_dir="tables",
            index_key="tables_index",
            id_field="table_name",
            parse_index=_parse_table_index,
            parse_detail=_parse_table_detail,
            resource_label="table",
        )
        self._indexes = indexes
        self._details = details
        return len(indexes)
```

## テスト

### conftest.py のパターン

#### テスト用 YAML データ

テストで使う YAML データを文字列定数として定義する。

```python
SAMPLE_INDEX_YAML = """\
tables_index:
  - table_name: test_table
    display_name: テストテーブル
    summary: "テスト用テーブル"
    category: テスト系
"""

SAMPLE_TABLE_YAML = """\
table_name: test_table
display_name: テストテーブル
summary: "テスト用テーブル"
category: テスト系
description: テスト用の説明文です。
data_source:
  type: postgresql
  table: test_table
columns:
  - name: id
    type: integer
    description: "主キー"
    nullable: false
  - name: name
    type: varchar(100)
    description: "名前"
    nullable: true
"""
```

#### テストデータディレクトリ生成ヘルパー

`tmp_path` フィクスチャと組み合わせ、テスト用の data/ 構造を動的に作成する。

```python
def _create_data_dir(
    base: Path,
    index_yaml: str,
    table_yamls: dict[str, str],
    term_index_yaml: str,
    term_yamls: dict[str, str],
    logic_index_yaml: str | None = None,
    logic_meta_yamls: dict[str, str] | None = None,
    logic_code_files: dict[str, str] | None = None,
) -> Path:
    """テスト用の data/ ディレクトリ構造を作成する。"""
    catalog_dir = base / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text(index_yaml, encoding="utf-8")
    for name, content in table_yamls.items():
        (tables_dir / name).write_text(content, encoding="utf-8")
    # ... glossary, logic も同様
    return base
```

#### フィクスチャ

```python
@pytest.fixture()
def sample_data_dir(tmp_path: Path) -> Path:
    """基本的なテストデータセットを生成する。"""
    return _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls=_COMMON_TERM_YAMLS,
        logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
        logic_meta_yamls=_COMMON_LOGIC_META_YAMLS,
        logic_code_files=_COMMON_LOGIC_CODE_FILES,
    )


@pytest.fixture()
def catalog_store(sample_data_dir: Path) -> CatalogStore:
    """ロード済みの CatalogStore を返す。"""
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    return store


@pytest.fixture()
def client(sample_data_dir: Path) -> TestClient:
    """API テスト用の TestClient を返す。"""
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
```

### Router テストのパターン

#### インデックスのテスト

```python
def test_get_table_index(client: TestClient) -> None:
    resp = client.get("/catalog/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert len(data["tables"]) == 1
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["display_name"] == "テストテーブル"
```

#### 詳細一括取得のテスト

正常系（全件見つかる）、部分一致（一部 not_found）、全件見つからない、の3パターンをテスト。

```python
def test_get_table_details_single(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["test_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == []


def test_get_table_details_partial_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["test_table", "nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == ["nonexistent"]


def test_get_table_details_all_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 0
    assert data["not_found"] == ["nonexistent"]
```

#### バリデーションエラーのテスト

空リスト送信時の 422 レスポンスを確認。

```python
def test_get_term_details_empty_term_names(client: TestClient) -> None:
    resp = client.post("/glossary/terms", json={"term_names": []})
    assert resp.status_code == 422
```

#### エラーレスポンスのテスト

```python
def test_get_logic_code_not_found(client: TestClient) -> None:
    resp = client.get("/logic/code/nonexistent")
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "LOGIC_NOT_FOUND"
```

#### ヘルスチェックのテスト

```python
def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"
    assert "catalog" in data
    assert isinstance(data["catalog"]["tables"], int)
```

### CatalogStore 単体テストのパターン

```python
def test_load_tables_from_index(sample_data_dir: Path) -> None:
    store = CatalogStore()
    count = store.load_tables(sample_data_dir)
    assert count == 1
    assert store.table_count == 1


def test_yaml_syntax_error(tmp_path: Path) -> None:
    catalog_dir = tmp_path / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("tables_index: []\n", encoding="utf-8")
    (tables_dir / "bad.yaml").write_text("key: [invalid", encoding="utf-8")

    store = CatalogStore()
    with pytest.raises(ValueError, match="YAML syntax error in bad.yaml"):
        store.load_tables(tmp_path)


def test_reload_replaces_data(sample_data_dir: Path, tmp_path: Path) -> None:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    assert store.table_count == 1

    empty_dir = tmp_path / "empty"
    catalog_dir = empty_dir / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("tables_index: []\n", encoding="utf-8")
    store.load_tables(empty_dir)
    assert store.table_count == 0
```

### Pydantic モデルの単体テスト

```python
def test_table_index_required_fields() -> None:
    idx = TableIndex(
        table_name="t",
        display_name="T",
        summary="summary",
        category="cat",
    )
    assert idx.table_name == "t"


def test_table_index_missing_field() -> None:
    with pytest.raises(ValidationError):
        TableIndex(table_name="t", display_name="T", summary="s")  # type: ignore[call-arg]


def test_table_detail_minimal() -> None:
    detail = TableDetail(
        table_name="t",
        display_name="T",
        description="d",
        columns=[],
    )
    assert detail.data_source is None
    assert detail.statistics is None
    assert detail.notes_table_level is None
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

## チェックリスト

### 新しいルーター追加時

1. `src/routers/{name}.py` を作成
   - `APIRouter(prefix="/{path}", tags=["{tag}"])` を定義
   - `Depends(get_catalog_store)` で依存性注入を使用
   - `index_response()` / `detail_response()` / `error_response()` でレスポンスを統一
2. `src/main.py` にルーターを登録
   - `from .routers import {name}` をインポート
   - `app.include_router({name}.router)` を追加
3. 必要に応じて `src/models.py` にリクエスト/レスポンスモデルを追加
   - リクエストモデルには `Field(..., min_length=1, max_length=100)` でバリデーション
   - 文字列フィールドには `_strip_string` バリデータの適用を検討
4. `src/catalog_loader.py` にデータ取得メソッドを追加
   - `_load_resource()` の共通パターンを活用
   - `_lookup_many()` で一括検索を実装
5. テストを追加
   - `tests/conftest.py` にサンプルデータ定数を追加
   - `tests/test_{name}_api.py` に API テストを作成
   - インデックス / 詳細一括(全件OK / 部分not_found / 全件not_found) / バリデーションエラーを網羅

### エンドポイント追加時の確認項目

- [ ] レスポンス形式が `{"data": ...}` / `{"error": ...}` に従っているか
- [ ] `response_model=None` を POST エンドポイントに指定しているか（手動で dict を返す場合）
- [ ] パスパラメータに正規表現バリデーション（`pattern`）と最大長を設定しているか
- [ ] エラーコードが `docs/design/api-contracts.md` のエラーコード一覧と整合しているか
- [ ] `model_dump()` 時に `by_alias=True` が必要なモデル（`DateRange` の `from` エイリアス等）を確認しているか
- [ ] テストで正常系・部分エラー・全件エラー・バリデーションエラーの4パターンを網羅しているか
