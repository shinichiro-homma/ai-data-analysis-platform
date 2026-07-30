from __future__ import annotations

from pathlib import Path

import pytest

from src.catalog_loader import CatalogStore

from .conftest import _create_data_dir

# --- Table index loading tests ---


def test_load_tables_from_index(sample_data_dir: Path) -> None:
    store = CatalogStore()
    count = store.load_tables(sample_data_dir)
    assert count["loaded"] == 1
    assert store.table_count == 1


def test_load_multiple_tables_from_index(full_data_dir: Path) -> None:
    store = CatalogStore()
    count = store.load_tables(full_data_dir)
    assert count["loaded"] == 2
    assert store.table_count == 2


def test_index_fields(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    indexes = store.get_all_indexes()
    assert len(indexes) == 1
    idx = indexes[0]
    assert idx.table_name == "test_table"
    assert idx.display_name == "テストテーブル"
    assert idx.summary == "テスト用テーブル"
    assert idx.category == "テスト系"


# --- Table detail loading tests ---


def test_get_detail(catalog_store: CatalogStore) -> None:
    detail = catalog_store.get_detail("test_table")
    assert detail is not None
    assert detail.table_name == "test_table"
    assert len(detail.columns) == 2


def test_get_detail_not_found(catalog_store: CatalogStore) -> None:
    assert catalog_store.get_detail("nonexistent") is None


# --- Batch get_table_details tests ---


def test_get_table_details_all_found(full_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_tables(full_data_dir)
    tables, not_found = store.get_table_details(["test_table", "full_table"])
    assert len(tables) == 2
    assert not_found == []


def test_get_table_details_partial_not_found(full_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_tables(full_data_dir)
    tables, not_found = store.get_table_details(["test_table", "nonexistent"])
    assert len(tables) == 1
    assert tables[0].table_name == "test_table"
    assert not_found == ["nonexistent"]


def test_get_table_details_all_not_found(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    tables, not_found = store.get_table_details(["nonexistent"])
    assert len(tables) == 0
    assert not_found == ["nonexistent"]


# --- key_types parse tests ---


def test_parse_key_types(full_data_dir: Path) -> None:
    """key_types を含む YAML が ColumnInfo.key_types にパースされること。"""
    store = CatalogStore()
    store.load_tables(full_data_dir)
    detail = store.get_detail("full_table")
    assert detail is not None
    col_member = next(c for c in detail.columns if c.name == "member_code")
    assert col_member.key_types is not None
    assert len(col_member.key_types) == 2
    assert col_member.key_types[0].value == "統合会員番号"
    assert col_member.key_types[0].condition == "member_type = '正会員'"
    assert col_member.key_types[1].value == "仮会員番号"
    assert col_member.key_type is None


def test_parse_without_key_types(full_data_dir: Path) -> None:
    """key_types のないカラムでは key_types が None のままであること。"""
    store = CatalogStore()
    store.load_tables(full_data_dir)
    detail = store.get_detail("full_table")
    assert detail is not None
    col_code = next(c for c in detail.columns if c.name == "code")
    assert col_code.key_types is None
    assert col_code.key_type == "テストコード"


# --- statistics additional parse tests ---


def test_parse_statistics_additional(full_data_dir: Path) -> None:
    """カスタム統計項目を含む YAML が Statistics.additional に正しくパースされること。"""
    store = CatalogStore()
    store.load_tables(full_data_dir)
    detail = store.get_detail("full_table")
    assert detail is not None
    assert detail.statistics is not None
    assert detail.statistics.additional == {
        "avg_basket_size": 3.2,
        "top_categories": ["食品", "日用品", "衣料"],
        "cancelled_rate": 0.05,
    }


def test_parse_statistics_no_additional(sample_data_dir: Path) -> None:
    """カスタム統計項目のない YAML が Statistics.additional = {} で正しくパースされること。"""
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    detail = store.get_detail("test_table")
    assert detail is not None
    # test_table has no statistics section
    assert detail.statistics is None


# --- Error handling tests ---


def test_yaml_syntax_error(tmp_path: Path) -> None:
    catalog_dir = tmp_path / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("tables_index: []\n", encoding="utf-8")
    (tables_dir / "bad.yaml").write_text("key: [invalid", encoding="utf-8")

    store = CatalogStore()
    with pytest.raises(ValueError, match="YAML syntax error in bad.yaml"):
        store.load_tables(tmp_path)


def test_index_yaml_syntax_error(tmp_path: Path) -> None:
    catalog_dir = tmp_path / "catalog"
    catalog_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("key: [invalid", encoding="utf-8")

    store = CatalogStore()
    with pytest.raises(ValueError, match="YAML syntax error in index.yaml"):
        store.load_tables(tmp_path)


def test_empty_tables_directory(tmp_path: Path) -> None:
    catalog_dir = tmp_path / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("tables_index: []\n", encoding="utf-8")

    store = CatalogStore()
    count = store.load_tables(tmp_path)
    assert count["loaded"] == 0
    assert store.table_count == 0


def test_missing_catalog_directory(tmp_path: Path) -> None:
    store = CatalogStore()
    count = store.load_tables(tmp_path)
    assert count["loaded"] == 0


def test_skip_file_without_table_name(tmp_path: Path) -> None:
    catalog_dir = tmp_path / "catalog"
    tables_dir = catalog_dir / "tables"
    tables_dir.mkdir(parents=True)
    (catalog_dir / "index.yaml").write_text("tables_index: []\n", encoding="utf-8")
    (tables_dir / "no_name.yaml").write_text("display_name: test\nsummary: test\n", encoding="utf-8")

    store = CatalogStore()
    result = store.load_tables(tmp_path)
    assert result["loaded"] == 0
    assert result["skipped"] == 1


def test_skip_counts_tracked_in_store(tmp_path: Path) -> None:
    """id_field 欠損ファイルを含むデータでロード後、store.skipped_files が正しいカウントを返すこと。"""
    # Arrange: tables に id_field 欠損ファイルを含める
    data_dir = _create_data_dir(
        tmp_path,
        index_yaml="tables_index: []\n",
        table_yamls={},
        term_index_yaml="terms_index: []\n",
        term_yamls={},
    )
    # tables に id_field (table_name) 欠損ファイルを手動追加
    tables_dir = data_dir / "catalog" / "tables"
    (tables_dir / "no_table_name.yaml").write_text("display_name: test\nsummary: test\n", encoding="utf-8")
    # terms に id_field (name) 欠損ファイルを手動追加
    terms_dir = data_dir / "glossary" / "terms"
    (terms_dir / "no_name.yaml").write_text("other_key: value\n", encoding="utf-8")

    # Act
    store = CatalogStore()
    store.load_tables(data_dir)
    store.load_terms(data_dir)
    store.load_logic(data_dir)

    # Assert
    skipped = store.skipped_files
    assert skipped["tables"] == 1
    assert skipped["terms"] == 1
    assert skipped["logic"] == 0


def test_skip_counts_include_external_tables(tmp_path: Path) -> None:
    """catalog/external/ 配下の id_field 欠損ファイルも skipped_files["tables"] に合算されること。"""
    # Arrange: catalog/tables に 1 件スキップ、catalog/external に 1 件スキップ
    data_dir = _create_data_dir(
        tmp_path,
        index_yaml="tables_index: []\n",
        table_yamls={},
        term_index_yaml="terms_index: []\n",
        term_yamls={},
    )
    tables_dir = data_dir / "catalog" / "tables"
    (tables_dir / "no_table_name.yaml").write_text("display_name: test\nsummary: test\n", encoding="utf-8")
    external_dir = data_dir / "catalog" / "external"
    external_dir.mkdir(parents=True)
    (external_dir / "no_table_name_ext.yaml").write_text("display_name: ext\nsummary: ext\n", encoding="utf-8")

    # Act
    store = CatalogStore()
    store.load_tables(data_dir)

    # Assert: tables + external のスキップ数が合算
    assert store.skipped_files["tables"] == 2


# --- Reload tests ---


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


def test_reload_reloads_index(sample_data_dir: Path) -> None:
    """reload時にインデックスも再読み込みされること。"""
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    assert store.table_count == 1

    # インデックスを書き換えて再読み込み
    index_path = sample_data_dir / "catalog" / "index.yaml"
    index_path.write_text("tables_index: []\n", encoding="utf-8")
    store.load_tables(sample_data_dir)
    assert store.table_count == 0


# --- Term loader tests ---


def test_load_terms(sample_data_dir: Path) -> None:
    store = CatalogStore()
    count = store.load_terms(sample_data_dir)
    assert count["loaded"] == 3
    assert store.term_count == 3


def test_load_terms_index_fields(sample_data_dir: Path) -> None:
    """index.yaml からインデックスが正しく読み込まれること。"""
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    indexes = store.get_all_term_indexes()
    assert len(indexes) == 3
    names = {idx.name for idx in indexes}
    assert "ロイヤルティランク" in names
    assert "統合会員ID" in names
    assert "店舗" in names


def test_load_terms_detail_from_individual_files(sample_data_dir: Path) -> None:
    """個別 YAML ファイルから用語詳細が読み込まれること。"""
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    terms, not_found = store.get_term_details(["ロイヤルティランク"])
    assert len(terms) == 1
    assert not_found == []
    detail = terms[0]
    assert detail.name == "ロイヤルティランク"
    assert "ロイヤルティランク" in detail.aliases
    assert detail.related_terms == ["統合会員ID"]
    assert detail.values is not None
    assert len(detail.values) == 2


def test_load_terms_detail_without_values(sample_data_dir: Path) -> None:
    """values なしの用語が正しくパースされること。"""
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    terms, _ = store.get_term_details(["店舗"])
    assert len(terms) == 1
    assert terms[0].values is None


def test_load_terms_empty_directory(tmp_path: Path) -> None:
    glossary_dir = tmp_path / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text("terms_index: []\n", encoding="utf-8")

    store = CatalogStore()
    count = store.load_terms(tmp_path)
    assert count["loaded"] == 0
    assert store.term_count == 0


def test_load_terms_missing_directory(tmp_path: Path) -> None:
    store = CatalogStore()
    count = store.load_terms(tmp_path)
    assert count["loaded"] == 0


def test_load_terms_yaml_syntax_error(tmp_path: Path) -> None:
    glossary_dir = tmp_path / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text("terms_index: []\n", encoding="utf-8")
    (terms_dir / "bad.yaml").write_text("key: [invalid", encoding="utf-8")

    store = CatalogStore()
    with pytest.raises(ValueError, match="YAML syntax error in bad.yaml"):
        store.load_terms(tmp_path)


def test_load_terms_skip_file_without_name_key(tmp_path: Path) -> None:
    glossary_dir = tmp_path / "glossary"
    terms_dir = glossary_dir / "terms"
    terms_dir.mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text("terms_index: []\n", encoding="utf-8")
    (terms_dir / "no_name.yaml").write_text("other_key: value\n", encoding="utf-8")

    store = CatalogStore()
    result = store.load_terms(tmp_path)
    assert result["loaded"] == 0
    assert result["skipped"] == 1


# --- Batch get_term_details tests ---


def test_get_term_details_all_found(catalog_store: CatalogStore) -> None:
    terms, not_found = catalog_store.get_term_details(["ロイヤルティランク", "統合会員ID"])
    assert len(terms) == 2
    assert not_found == []


def test_get_term_details_partial_not_found(catalog_store: CatalogStore) -> None:
    terms, not_found = catalog_store.get_term_details(["ロイヤルティランク", "nonexistent"])
    assert len(terms) == 1
    assert terms[0].name == "ロイヤルティランク"
    assert not_found == ["nonexistent"]


def test_get_term_details_all_not_found(catalog_store: CatalogStore) -> None:
    terms, not_found = catalog_store.get_term_details(["nonexistent"])
    assert len(terms) == 0
    assert not_found == ["nonexistent"]


# --- Term reload tests ---


def test_reload_terms_replaces_data(sample_data_dir: Path, tmp_path: Path) -> None:
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    assert store.term_count == 3

    empty_dir = tmp_path / "empty"
    glossary_dir = empty_dir / "glossary"
    (glossary_dir / "terms").mkdir(parents=True)
    (glossary_dir / "index.yaml").write_text("terms_index: []\n", encoding="utf-8")
    store.load_terms(empty_dir)
    assert store.term_count == 0


def test_reload_terms_reloads_index(sample_data_dir: Path) -> None:
    """reload時にインデックスも再読み込みされること。"""
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    assert store.term_count == 3

    index_path = sample_data_dir / "glossary" / "index.yaml"
    index_path.write_text("terms_index: []\n", encoding="utf-8")
    store.load_terms(sample_data_dir)
    assert store.term_count == 0


# --- Term search index tests ---


def test_build_term_search_index(catalog_store: CatalogStore) -> None:
    """検索インデックスが aliases を含んで構築されること。"""
    # _term_search_index は内部属性だが、search_term_indexes の動作で検証
    results = catalog_store.search_term_indexes("ロイヤルティランク")
    assert len(results) >= 1
    assert any(r.name == "ロイヤルティランク" for r in results)


def test_search_term_indexes_by_alias(catalog_store: CatalogStore) -> None:
    """aliases での部分一致検索が動作すること。"""
    results = catalog_store.search_term_indexes("Loyalty")
    assert len(results) == 1
    assert results[0].name == "ロイヤルティランク"


def test_search_term_indexes_case_insensitive(catalog_store: CatalogStore) -> None:
    """大文字小文字を区別しないこと。"""
    results_lower = catalog_store.search_term_indexes("loyalty rank")
    results_upper = catalog_store.search_term_indexes("LOYALTY RANK")
    assert len(results_lower) == len(results_upper)
    assert len(results_lower) >= 1


def test_search_term_indexes_no_match(catalog_store: CatalogStore) -> None:
    """ヒットなしの場合は空リストが返ること。"""
    results = catalog_store.search_term_indexes("存在しない用語XYZ")
    assert results == []


def test_search_term_indexes_multiple_match(catalog_store: CatalogStore) -> None:
    """複数用語にマッチする場合、全てが返ること。"""
    # "統合" は "統合会員ID" の name に含まれる
    results = catalog_store.search_term_indexes("統合")
    names = {r.name for r in results}
    assert "統合会員ID" in names


def test_search_index_rebuilt_on_reload(sample_data_dir: Path) -> None:
    """reload 時に検索インデックスが再構築されること。"""
    store = CatalogStore()
    store.load_terms(sample_data_dir)
    assert len(store.search_term_indexes("Loyalty")) == 1

    # index.yaml を空にして再読み込み
    index_path = sample_data_dir / "glossary" / "index.yaml"
    index_path.write_text("terms_index: []\n", encoding="utf-8")
    store.load_terms(sample_data_dir)
    assert len(store.search_term_indexes("Loyalty")) == 0


# --- Logic loader tests ---


def test_load_logic_indexes(sample_data_dir: Path) -> None:
    store = CatalogStore()
    count = store.load_logic(sample_data_dir)
    assert count["loaded"] == 2
    assert store.logic_count == 2


def test_load_logic_meta(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    metas, not_found = store.get_logic_metas(["member_id_remapping"])
    assert len(metas) == 1
    assert not_found == []
    meta = metas[0]
    assert meta.logic_name == "member_id_remapping"
    assert meta.language == "sql"
    assert meta.usage_type == "template"
    assert "purchase_history" in meta.input_tables


def test_load_logic_meta_optional_fields(sample_data_dir: Path) -> None:
    """任意フィールド（usage_context, related_logic, notes）の有無。"""
    store = CatalogStore()
    store.load_logic(sample_data_dir)

    metas, _ = store.get_logic_metas(["member_id_remapping"])
    assert metas[0].usage_context is not None
    assert metas[0].related_logic == ["sales_basic_aggregation"]
    assert metas[0].notes is not None

    metas2, _ = store.get_logic_metas(["sales_basic_aggregation"])
    assert metas2[0].usage_context is None
    assert metas2[0].related_logic is None
    assert metas2[0].notes is None


def test_get_logic_metas_all_found(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    metas, not_found = store.get_logic_metas(["member_id_remapping", "sales_basic_aggregation"])
    assert len(metas) == 2
    assert not_found == []


def test_get_logic_metas_partial_not_found(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    metas, not_found = store.get_logic_metas(["member_id_remapping", "nonexistent"])
    assert len(metas) == 1
    assert metas[0].logic_name == "member_id_remapping"
    assert not_found == ["nonexistent"]


def test_get_logic_metas_all_not_found(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    metas, not_found = store.get_logic_metas(["nonexistent"])
    assert len(metas) == 0
    assert not_found == ["nonexistent"]


def test_get_logic_code_sql(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    result = store.get_logic_code("member_id_remapping")
    assert result is not None
    assert result["logic_name"] == "member_id_remapping"
    assert result["language"] == "sql"
    assert "COALESCE" in result["code"]


def test_get_logic_code_python(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    result = store.get_logic_code("sales_basic_aggregation")
    assert result is not None
    assert result["logic_name"] == "sales_basic_aggregation"
    assert result["language"] == "python"
    assert "import pandas" in result["code"]


def test_get_logic_code_not_found(sample_data_dir: Path) -> None:
    store = CatalogStore()
    store.load_logic(sample_data_dir)
    result = store.get_logic_code("nonexistent")
    assert result is None


def test_load_logic_missing_dir(tmp_path: Path) -> None:
    store = CatalogStore()
    count = store.load_logic(tmp_path)
    assert count["loaded"] == 0


def test_logic_count(sample_data_dir: Path) -> None:
    store = CatalogStore()
    assert store.logic_count == 0
    store.load_logic(sample_data_dir)
    assert store.logic_count == 2
