from __future__ import annotations

import os
from pathlib import Path

# Set DOCUMENT_SERVER_TOKEN before importing src modules (config.py reads it at import time).
os.environ.setdefault("DOCUMENT_SERVER_TOKEN", "test-token")

import pytest
from fastapi.testclient import TestClient

from src.catalog_loader import CatalogStore
from src.main import app

TEST_TOKEN = os.environ["DOCUMENT_SERVER_TOKEN"]
AUTH_HEADERS = {"Authorization": f"Bearer {TEST_TOKEN}"}

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

SAMPLE_TERM_INDEX_YAML = """\
terms_index:
  - name: "ロイヤルティランク"
    summary: "統合会員の購買実績に基づく顧客ロイヤルティランク"
  - name: "統合会員ID"
    summary: "サンプル株式会社の統合顧客ID体系"
  - name: "店舗"
    summary: "各店舗の総称"
"""

SAMPLE_TERM_STAR_RANK_YAML = """\
name: "ロイヤルティランク"
aliases: ["ロイヤルティランク", "Loyalty Rank", "顧客ランク"]
definition: "統合会員の購買実績に基づく顧客ロイヤルティランク。"
related_terms: ["統合会員ID"]
values:
  - label: "レギュラー"
    description: "基本ランク"
  - label: "シルバー"
    description: "年間購買額XX万円以上"
"""

SAMPLE_TERM_MEMBER_ID_YAML = """\
name: "統合会員ID"
aliases: ["統合会員ID", "統合顧客ID"]
definition: "サンプル株式会社の統合顧客ID体系。"
related_terms: ["メンバーズカード"]
"""

SAMPLE_TERM_TATE_YAML = """\
name: "店舗"
aliases: ["施設", "チェーン店"]
definition: "各店舗の総称。"
"""

FULL_INDEX_YAML = """\
tables_index:
  - table_name: test_table
    display_name: テストテーブル
    summary: "テスト用テーブル"
    category: テスト系
  - table_name: full_table
    display_name: フルテーブル
    summary: "全フィールド定義テーブル"
    category: テスト系
"""

SAMPLE_TABLE_FULL_YAML = """\
table_name: full_table
display_name: フルテーブル
summary: "全フィールド定義テーブル"
category: テスト系
description: |
  全フィールドを含むテーブル。
  テスト用。
data_source:
  type: postgresql
  table: full_table
columns:
  - name: code
    type: varchar(8)
    description: "コード"
    nullable: false
    key_type: "テストコード"
    domain:
      master_table: master
      master_column: code
      label_column: label
    notes: "マスタ参照型の注意点"
    examples: ["A001", "B002"]
  - name: member_code
    type: varchar(20)
    description: "会員コード"
    nullable: false
    key_types:
      - value: "統合会員番号"
        condition: "member_type = '正会員'"
      - value: "仮会員番号"
        condition: "member_type = '仮会員'"
  - name: status
    type: varchar(16)
    description: "ステータス"
    nullable: false
    domain:
      values:
        - active
        - inactive
statistics:
  row_count: 1000
  date_range:
    from: "2024-01-01"
    to: "2024-12-31"
  update_frequency: "月次"
  avg_basket_size: 3.2
  top_categories: ["食品", "日用品", "衣料"]
  cancelled_rate: 0.05
notes_table_level:
  - "注意点1"
  - "注意点2"
"""

# --- Logic sample data ---

SAMPLE_LOGIC_INDEX_YAML = """\
logic_index:
  - logic_name: "member_id_remapping"
    summary: "統合会員IDの洗い替え処理"
    category: "前処理"
  - logic_name: "sales_basic_aggregation"
    summary: "店舗別・顧客セグメント別の売上基礎集計"
    category: "集計"
"""

SAMPLE_LOGIC_META_REMAPPING_YAML = """\
logic_name: "member_id_remapping"
description: "統合会員IDの洗い替え処理。"
file_path: "logic/code/sql/member_id_remapping.sql"
language: "sql"
usage_type: "template"
input_tables: ["purchase_history", "member_id_mapping"]
output_description: "洗い替え後のcustomer_idを持つトランザクションデータ"
usage_context: "購買データ分析の前処理として使う。"
related_logic: ["sales_basic_aggregation"]
notes: "マッピングテーブルは月次更新。"
"""

SAMPLE_LOGIC_META_AGGREGATION_YAML = """\
logic_name: "sales_basic_aggregation"
description: "店舗別・顧客セグメント別の売上基礎集計。"
file_path: "logic/code/python/sales_basic_aggregation.py"
language: "python"
usage_type: "reference"
input_tables: ["purchase_history", "customer_master"]
output_description: "店舗別・顧客セグメント別の売上集計DataFrame"
"""

SAMPLE_SQL_CODE = """\
SELECT COALESCE(m.new_member_id, t.customer_id) AS customer_id
FROM purchase_history t
LEFT JOIN member_id_mapping m ON t.customer_id = m.old_member_id
"""

SAMPLE_PYTHON_CODE = """\
import pandas as pd

def aggregate_sales(df):
    return df.groupby("store_code").agg(total=("amount", "sum"))
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

    if logic_index_yaml is not None:
        logic_dir = base / "logic"
        meta_dir = logic_dir / "meta"
        meta_dir.mkdir(parents=True)
        (logic_dir / "index.yaml").write_text(logic_index_yaml, encoding="utf-8")
        if logic_meta_yamls:
            for name, content in logic_meta_yamls.items():
                (meta_dir / name).write_text(content, encoding="utf-8")
        if logic_code_files:
            for rel_path, content in logic_code_files.items():
                code_path = logic_dir / rel_path
                code_path.parent.mkdir(parents=True, exist_ok=True)
                code_path.write_text(content, encoding="utf-8")

    return base


_COMMON_TERM_YAMLS = {
    "ロイヤルティランク.yaml": SAMPLE_TERM_STAR_RANK_YAML,
    "統合会員ID.yaml": SAMPLE_TERM_MEMBER_ID_YAML,
    "館.yaml": SAMPLE_TERM_TATE_YAML,
}

_COMMON_LOGIC_META_YAMLS = {
    "member_id_remapping.yaml": SAMPLE_LOGIC_META_REMAPPING_YAML,
    "sales_basic_aggregation.yaml": SAMPLE_LOGIC_META_AGGREGATION_YAML,
}

_COMMON_LOGIC_CODE_FILES = {
    "code/sql/member_id_remapping.sql": SAMPLE_SQL_CODE,
    "code/python/sales_basic_aggregation.py": SAMPLE_PYTHON_CODE,
}


@pytest.fixture()
def sample_data_dir(tmp_path: Path) -> Path:
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
def full_data_dir(tmp_path: Path) -> Path:
    return _create_data_dir(
        tmp_path,
        index_yaml=FULL_INDEX_YAML,
        table_yamls={
            "test_table.yaml": SAMPLE_TABLE_YAML,
            "full_table.yaml": SAMPLE_TABLE_FULL_YAML,
        },
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls=_COMMON_TERM_YAMLS,
        logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
        logic_meta_yamls=_COMMON_LOGIC_META_YAMLS,
        logic_code_files=_COMMON_LOGIC_CODE_FILES,
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
    test_client = TestClient(app)
    test_client.headers.update(AUTH_HEADERS)
    return test_client


@pytest.fixture()
def client_full(full_data_dir: Path) -> TestClient:
    store = CatalogStore()
    store.load_tables(full_data_dir)
    store.load_terms(full_data_dir)
    store.load_logic(full_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    test_client = TestClient(app)
    test_client.headers.update(AUTH_HEADERS)
    return test_client


@pytest.fixture()
def unauthed_client(sample_data_dir: Path) -> TestClient:
    """Client without auth headers for testing 401 responses."""
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    return TestClient(app)
