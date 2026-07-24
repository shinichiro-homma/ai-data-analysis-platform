from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from .conftest import (
    SAMPLE_LOGIC_META_AGGREGATION_YAML,
    SAMPLE_LOGIC_META_REMAPPING_YAML,
    SAMPLE_PYTHON_CODE,
    SAMPLE_SQL_CODE,
    SAMPLE_TERM_MEMBER_ID_YAML,
    SAMPLE_TERM_STAR_RANK_YAML,
    SAMPLE_TERM_TATE_YAML,
)

# ---------------------------------------------------------------------------
# 移設テスト: test_tables_api.py / test_terms_api.py から移設
# ---------------------------------------------------------------------------


def test_reload_catalog(client: TestClient) -> None:
    resp = client.post("/admin/reload")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "reloaded"
    assert isinstance(data["tables_loaded"], int)
    assert isinstance(data["terms_loaded"], int)
    assert data["logic_loaded"] == 2
    assert "reload_time_ms" in data


def test_reload_includes_terms(client: TestClient) -> None:
    resp = client.post("/admin/reload")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "reloaded"
    assert isinstance(data["terms_loaded"], int)


# ---------------------------------------------------------------------------
# 新規テスト: アトミック性の検証
# ---------------------------------------------------------------------------

_COMMON_TERM_YAMLS = {
    "ロイヤルティランク.yaml": SAMPLE_TERM_STAR_RANK_YAML,
    "統合会員ID.yaml": SAMPLE_TERM_MEMBER_ID_YAML,
    "店舗.yaml": SAMPLE_TERM_TATE_YAML,
}

_COMMON_LOGIC_META_YAMLS = {
    "member_id_remapping.yaml": SAMPLE_LOGIC_META_REMAPPING_YAML,
    "sales_basic_aggregation.yaml": SAMPLE_LOGIC_META_AGGREGATION_YAML,
}

_COMMON_LOGIC_CODE_FILES = {
    "code/sql/member_id_remapping.sql": SAMPLE_SQL_CODE,
    "code/python/sales_basic_aggregation.py": SAMPLE_PYTHON_CODE,
}


def test_reload_failure_keeps_old_catalog(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """reload が失敗した場合、旧データがそのまま残ること。"""

    # Arrange: 旧データで /catalog/index が取得できることを確認
    resp_before = client.get("/catalog/index")
    assert resp_before.status_code == 200
    old_total = resp_before.json()["data"]["total"]
    assert old_total >= 1

    health_before = client.get("/health")
    assert health_before.status_code == 200
    old_last_reload = health_before.json()["catalog"]["last_reload"]

    # 構文エラーの index.yaml を持つデータディレクトリを作成
    broken_dir = tmp_path / "broken"
    broken_dir.mkdir()
    catalog_dir = broken_dir / "catalog"
    catalog_dir.mkdir()
    (catalog_dir / "index.yaml").write_text(
        "tables_index:\n  - {invalid yaml: [unterminated",
        encoding="utf-8",
    )

    import src.routers.admin as admin_module

    monkeypatch.setattr(admin_module, "DATA_DIR", broken_dir)

    # Act: reload を実行（失敗を期待）
    resp_reload = client.post("/admin/reload")

    # Assert: 400 + CATALOG_LOAD_ERROR
    assert resp_reload.status_code == 400
    assert resp_reload.json()["error"]["code"] == "CATALOG_LOAD_ERROR"

    # 旧データが維持されていること
    monkeypatch.undo()
    resp_after = client.get("/catalog/index")
    assert resp_after.status_code == 200
    assert resp_after.json()["data"]["total"] == old_total

    # last_reload が変わっていないこと
    health_after = client.get("/health")
    assert health_after.status_code == 200
    assert health_after.json()["catalog"]["last_reload"] == old_last_reload


def test_reload_partial_failure_keeps_old_catalog(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """catalog は有効だが glossary が壊れている場合、部分適用されないこと。"""

    # Arrange: 旧データの /catalog/index を確認
    resp_before = client.get("/catalog/index")
    assert resp_before.status_code == 200
    old_tables = [t["table_name"] for t in resp_before.json()["data"]["tables"]]

    # 別名テーブルを持つ有効な catalog + 壊れた glossary のデータディレクトリ
    partial_dir = tmp_path / "partial"
    partial_dir.mkdir()

    # catalog は有効（別名テーブル alt_table を含む）
    alt_index_yaml = """\
tables_index:
  - table_name: alt_table
    display_name: 代替テーブル
    summary: "代替テスト用テーブル"
    category: テスト系
"""
    alt_table_yaml = """\
table_name: alt_table
display_name: 代替テーブル
summary: "代替テスト用テーブル"
category: テスト系
description: 代替テスト用の説明文です。
data_source:
  type: postgresql
  table: alt_table
columns:
  - name: id
    type: integer
    description: "主キー"
    nullable: false
"""
    catalog_dir = partial_dir / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text(alt_index_yaml, encoding="utf-8")
    (tables_dir / "alt_table.yaml").write_text(alt_table_yaml, encoding="utf-8")

    # glossary は壊れている
    glossary_dir = partial_dir / "glossary"
    glossary_dir.mkdir()
    (glossary_dir / "index.yaml").write_text(
        "terms_index:\n  - {broken yaml: [unterminated",
        encoding="utf-8",
    )

    import src.routers.admin as admin_module

    monkeypatch.setattr(admin_module, "DATA_DIR", partial_dir)

    # Act
    resp_reload = client.post("/admin/reload")

    # Assert: 400 が返ること
    assert resp_reload.status_code == 400

    # 新テーブル alt_table が混入していないこと（部分適用の回帰テスト）
    monkeypatch.undo()
    resp_after = client.get("/catalog/index")
    assert resp_after.status_code == 200
    after_tables = [t["table_name"] for t in resp_after.json()["data"]["tables"]]
    assert "alt_table" not in after_tables
    assert after_tables == old_tables


def test_reload_swaps_store_instance(
    client: TestClient,
    sample_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reload 成功後に app.state.catalog_store が別インスタンスに差し替わること。"""
    from src.main import app

    # Arrange: reload 前のストアインスタンスを記録
    old_store = app.state.catalog_store

    import src.routers.admin as admin_module

    monkeypatch.setattr(admin_module, "DATA_DIR", sample_data_dir)

    # Act: reload 実行
    resp = client.post("/admin/reload")
    assert resp.status_code == 200

    # Assert: ストアが別インスタンスになっている（copy-on-write の直接検証）
    new_store = app.state.catalog_store
    assert new_store is not old_store
