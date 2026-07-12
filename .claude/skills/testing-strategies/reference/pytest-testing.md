## pytest (Python REST API サーバー)

### プロジェクト構成

```
document-server/
├── pyproject.toml                  # pytest 設定（testpaths, asyncio_mode）
├── src/
│   ├── main.py                     # FastAPI app
│   ├── models.py
│   ├── catalog_loader.py           # CatalogStore
│   └── routers/
│       ├── catalog.py
│       ├── glossary.py
│       ├── logic.py
│       └── admin.py
└── tests/
    ├── __init__.py
    ├── conftest.py                 # フィクスチャ定義（YAML テストデータ、TestClient 生成）
    ├── test_tables_api.py
    ├── test_terms_api.py
    ├── test_logic_api.py
    ├── test_models.py
    ├── test_catalog_loader.py
    └── test_health.py
```

### テスト実行コマンド

```bash
cd document-server
pytest                   # 全テスト実行
pytest -v                # 詳細表示
pytest --cov=src         # カバレッジレポート
pytest tests/test_tables_api.py  # 個別ファイル
```

### pytest 設定 (pyproject.toml)

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
```

### conftest.py パターン

テストデータは YAML 文字列としてインラインで定義し、`tmp_path` フィクスチャを使って一時ディレクトリに書き出す。`CatalogStore` にロードした後、FastAPI の `TestClient` を生成する。

```python
from __future__ import annotations
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from src.catalog_loader import CatalogStore
from src.main import app

# YAML テストデータをインラインで定義
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
description: テスト用の説明文です。
data_source:
  type: postgresql
  table: test_table
columns:
  - name: id
    type: integer
    description: "主キー"
    nullable: false
"""

SAMPLE_TERM_INDEX_YAML = """\
terms_index:
  - name: "ロイヤルティランク"
    summary: "統合会員の購買実績に基づく顧客ロイヤルティランク"
"""

SAMPLE_TERM_YAML = """\
name: "ロイヤルティランク"
aliases: ["ロイヤルティランク", "Loyalty Rank"]
definition: "統合会員の購買実績に基づく顧客ロイヤルティランク。"
related_terms: ["統合会員ID"]
values:
  - label: "レギュラー"
    description: "基本ランク"
"""


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

    glossary_dir = base / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text(term_index_yaml, encoding="utf-8")
    for name, content in term_yamls.items():
        (terms_dir / name).write_text(content, encoding="utf-8")

    # logic 省略...
    return base


@pytest.fixture()
def sample_data_dir(tmp_path: Path) -> Path:
    return _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls={"ロイヤルティランク.yaml": SAMPLE_TERM_YAML},
    )


@pytest.fixture()
def catalog_store(sample_data_dir: Path) -> CatalogStore:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    return store


@pytest.fixture()
def client(sample_data_dir: Path) -> TestClient:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
```

重要なポイント:
- `_create_data_dir()` ヘルパーで YAML ファイルの配置を一元管理
- `client` フィクスチャは `sample_data_dir` に依存し、`CatalogStore` をロード済みの状態で `TestClient` を提供
- `full_data_dir` のようなバリエーションフィクスチャで、異なるデータセットに対応

### Router テストテンプレート

```python
from __future__ import annotations
from fastapi.testclient import TestClient


def test_get_index(client: TestClient) -> None:
    resp = client.get("/catalog/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert len(data["tables"]) == 1
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["display_name"] == "テストテーブル"


def test_get_details_single(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["test_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == []
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["description"] == "テスト用の説明文です。"
    assert len(t["columns"]) == 2


def test_get_details_partial_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["test_table", "nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == ["nonexistent"]


def test_get_details_all_not_found(client: TestClient) -> None:
    resp = client.post(
        "/catalog/tables", json={"table_names": ["nonexistent"]}
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 0
    assert data["not_found"] == ["nonexistent"]


def test_get_details_empty_names(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": []})
    assert resp.status_code == 422


def test_not_found_error(client: TestClient) -> None:
    resp = client.get("/logic/code/nonexistent")
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "LOGIC_NOT_FOUND"
```

### フィクスチャパターン

| フィクスチャ | 説明 | 依存 |
|-------------|------|------|
| `sample_data_dir` | 基本テストデータを一時ディレクトリに配置 | `tmp_path` |
| `full_data_dir` | 全フィールド入りデータを配置 | `tmp_path` |
| `catalog_store` | データロード済みの `CatalogStore` | `sample_data_dir` |
| `client` | 基本データでの `TestClient` | `sample_data_dir` |
| `client_full` | 全フィールドデータでの `TestClient` | `full_data_dir` |

フィクスチャ間の依存を利用し、コード重複を防ぐ:

```python
@pytest.fixture()
def catalog_store(sample_data_dir: Path) -> CatalogStore:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    return store

@pytest.fixture()
def client(sample_data_dir: Path) -> TestClient:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
```

### 特殊ケーステスト（ファイル不在時の動作検証）

conftest のヘルパーを直接使って、特殊なテストデータ配置を行うパターン。

```python
from .conftest import _create_data_dir, SAMPLE_INDEX_YAML, SAMPLE_TABLE_YAML, ...

def test_code_file_missing(tmp_path: Path) -> None:
    """メタはあるがコードファイルがない場合。"""
    data_dir = _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls=_COMMON_TERM_YAMLS,
        logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
        logic_meta_yamls={"member_id_remapping.yaml": SAMPLE_LOGIC_META_REMAPPING_YAML},
        logic_code_files={},  # コードファイルなし
    )
    store = CatalogStore()
    store.load_tables(data_dir)
    store.load_terms(data_dir)
    store.load_logic(data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    test_client = TestClient(app)

    resp = test_client.get("/logic/code/member_id_remapping")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "LOGIC_CODE_NOT_FOUND"
```

## pytest (jupyter-server / カスタム拡張)

document-server とは規約が異なる。フラット構成 + クラスベース命名 + 重い依存の手動モックが中心。

### プロジェクト構成

```
jupyter-server/
├── pyproject.toml                  # testpaths = ["tests"], asyncio_mode = "auto"
├── extensions/
│   └── custom_api/                 # __init__.py, handlers.py, sql_handlers.py,
│                                    # notebook_locks.py, workspace_handlers.py, ai_events.py 等
└── tests/                          # サブディレクトリなしのフラット構成
    ├── conftest.py
    ├── test_base.py
    ├── test_sql_handlers.py
    ├── test_notebook_locks.py
    └── test_*.py
```

### テスト実行コマンド

`pytest` を直接実行しない。`scripts/test.sh --quiet --test --no-lint jupyter-server -- tests/test_sql_handlers.py` のように `scripts/test.sh` 経由で実行する（`.claude/rules/tdd.md` 参照）。

### conftest.py の仕組み

`extensions/custom_api/__init__.py` は `jupyter_server` / `tornado` / `sqlalchemy` / `pandas` 等の重い依存を import 時に要求するため、テストから素朴に import できない。conftest.py はこれをモックで解決する。

- `_ensure(name, **attrs)`（35-41 行、`_load_init_module` 内部）: `sys.modules` に空の `ModuleType` を登録し、必要な属性だけ生やす軽量モック。既登録ならスキップ
- `_load_init_module()`（19-93 行）: 上記モックを一式登録した後、`extensions/custom_api/__init__.py` を `importlib.util.spec_from_file_location` でファイルから直接ロードし、`custom_api.__init__` として `sys.modules` に登録する。ロード後は `pkg.__init__ = mod` により `from custom_api import __init__ as init_module` でアクセス可能になる
- `setup_custom_api_init`（96-99 行）: `scope="session", autouse=True` フィクスチャ。セッション開始時に一度だけ `_load_init_module()` を呼ぶため、個別テストが明示的に依存する必要はない
- 各テストファイルは、対象モジュール固有の追加モック（`custom_api.base` 等）を上乗せしてから import する（test_notebook_locks.py 45-54 行が自前ローダーの例）。必要なモックの粒度がファイルごとに異なるため、conftest 一つに寄せず各ファイルの冒頭で個別に構築するのが通例

### 命名規約

`class Test{対象}` + `def test_{振る舞い}` で記述し、正常系・異常系・エッジケースをクラス単位で分割する（document-server のようなフラットな `def test_...` の羅列にはしない。`.claude/rules/testing.md` の Python 規約に対応）。

```python
class TestClassifySqlSelect:
    """SELECT 系のテスト"""

    def test_simple_select(self):
        result = _classify_sql("SELECT * FROM t")
        assert result.is_select is True


class TestClassifySqlAllowedDDL:
    """許可される DDL 系のテスト"""

    def test_create_temp_table(self): ...
```

### async テストの書き方

`pyproject.toml` は `asyncio_mode = "auto"` だが、既存コードは明示的に `@pytest.mark.asyncio` を付けている（test_notebook_locks.py 283-284 行）。新規テストもこれに倣う。`AsyncMock` で非同期の委譲先をモックし、`assert_awaited_once()` / `assert_not_called()` で呼び出しを検証する。

```python
class TestSaveWrapEnforcement:
    @pytest.mark.asyncio
    async def test_locked_notebook_without_token_raises_423(self):
        original_save = AsyncMock()
        wrapped = init_module._wrap_contents_save(original_save)
        with pytest.raises(Exception) as exc_info:
            await wrapped({"type": "notebook"}, path)
        assert getattr(exc_info.value, "status_code", None) == 423
        original_save.assert_not_called()
```

### 新しいテストを書くとき参照すべき代表ファイル

| 用途 | 参照ファイル:行範囲 |
|------|---------------------|
| 最小構成（依存モックなしの純関数テスト） | `tests/test_base.py:1-56` |
| 重い依存（pandas/sqlalchemy/tornado）を手動モックしてモジュール単体をロード | `tests/test_sql_handlers.py:1-70` |
| `class Test{対象}` + `def test_{振る舞い}` の代表例 | `tests/test_sql_handlers.py:76-100` |
| `__init__.py` 経由のロードと `_load_init_module` の利用 | `tests/conftest.py:19-99` |
| async テスト・`AsyncMock` によるハンドラ委譲検証 | `tests/test_notebook_locks.py:280-330` |
| autouse フィクスチャによる状態クリア（`clear_all` パターン） | `tests/test_notebook_locks.py:69-76` |
