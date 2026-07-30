from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def patch_data_dir(monkeypatch: pytest.MonkeyPatch) -> Callable[[Path], None]:
    import src.routers.admin as admin_module

    def _patch(path: Path) -> None:
        monkeypatch.setattr(admin_module, "DATA_DIR", path)

    return _patch


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
    # skipped_files フィールドが含まれること
    assert "skipped_files" in data
    assert data["skipped_files"]["tables"] == 0
    assert data["skipped_files"]["terms"] == 0
    assert data["skipped_files"]["logic"] == 0


def test_reload_includes_terms(client: TestClient) -> None:
    resp = client.post("/admin/reload")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "reloaded"
    assert isinstance(data["terms_loaded"], int)


# ---------------------------------------------------------------------------
# 新規テスト: アトミック性の検証
# ---------------------------------------------------------------------------


def test_reload_failure_keeps_old_catalog(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    patch_data_dir: Callable[[Path], None],
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

    patch_data_dir(broken_dir)

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
    patch_data_dir: Callable[[Path], None],
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

    patch_data_dir(partial_dir)

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
    patch_data_dir: Callable[[Path], None],
) -> None:
    """reload 成功後に app.state.catalog_store が別インスタンスに差し替わること。"""
    from src.main import app

    # Arrange: reload 前のストアインスタンスを記録
    old_store = app.state.catalog_store

    patch_data_dir(sample_data_dir)

    # Act: reload 実行
    resp = client.post("/admin/reload")
    assert resp.status_code == 200

    # Assert: ストアが別インスタンスになっている（copy-on-write の直接検証）
    new_store = app.state.catalog_store
    assert new_store is not old_store


def test_reload_reports_skipped_files(
    client: TestClient,
    tmp_path: Path,
    patch_data_dir: Callable[[Path], None],
) -> None:
    """スキップファイルを含むデータで reload し、レスポンスに skipped_files が含まれること。"""
    # Arrange: id_field 欠損ファイルを含むデータディレクトリを作成
    data_dir = tmp_path / "with_skips"
    data_dir.mkdir()

    # catalog: 有効なテーブル 1 件 + id_field 欠損 1 件
    catalog_dir = data_dir / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text(
        "tables_index:\n"
        "  - table_name: valid_table\n"
        "    display_name: Valid\n"
        '    summary: "valid"\n'
        "    category: test\n",
        encoding="utf-8",
    )
    (tables_dir / "valid_table.yaml").write_text(
        "table_name: valid_table\n"
        "display_name: Valid\n"
        'summary: "valid"\n'
        "category: test\n"
        "description: valid table\n"
        "data_source:\n"
        "  type: postgresql\n"
        "  table: valid_table\n"
        "columns:\n"
        "  - name: id\n"
        "    type: integer\n"
        '    description: "PK"\n'
        "    nullable: false\n",
        encoding="utf-8",
    )
    (tables_dir / "no_table_name.yaml").write_text("display_name: bad\nsummary: bad\n", encoding="utf-8")

    # glossary: 空（スキップ 0）
    glossary_dir = data_dir / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text("terms_index: []\n", encoding="utf-8")

    patch_data_dir(data_dir)

    # Act
    resp = client.post("/admin/reload")

    # Assert
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert "skipped_files" in data
    assert data["skipped_files"]["tables"] == 1
    assert data["skipped_files"]["terms"] == 0
    assert data["skipped_files"]["logic"] == 0
