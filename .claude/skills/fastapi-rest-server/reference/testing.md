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
