from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.models import (
    ColumnDomainMaster,
    ColumnDomainValues,
    ColumnInfo,
    ConditionalKeyType,
    DataSource,
    DateRange,
    Statistics,
    TableDetail,
    TableIndex,
    TermDetail,
    TermIndex,
    TermValue,
)


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


def test_table_detail_all_fields() -> None:
    detail = TableDetail(
        table_name="t",
        display_name="T",
        description="desc",
        data_source=DataSource(type="postgresql", table="t"),
        columns=[ColumnInfo(name="id", type="int", description="pk", nullable=False)],
        statistics=Statistics(
            row_count=100,
            date_range=DateRange(**{"from": "2024-01-01", "to": "2024-12-31"}),
            update_frequency="daily",
        ),
        notes_table_level=["note1"],
    )
    assert detail.statistics is not None
    assert detail.statistics.row_count == 100
    assert detail.statistics.date_range is not None
    assert detail.statistics.date_range.from_ == "2024-01-01"


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


def test_data_source_postgresql() -> None:
    ds = DataSource(type="postgresql", table="purchase_history")
    assert ds.type == "postgresql"
    assert ds.table == "purchase_history"
    assert ds.file_path is None
    assert ds.encoding is None


def test_data_source_csv() -> None:
    ds = DataSource(type="csv", file_path="data/sample.csv", encoding="utf-8")
    assert ds.type == "csv"
    assert ds.table is None
    assert ds.file_path == "data/sample.csv"
    assert ds.encoding == "utf-8"


def test_column_info_required_only() -> None:
    col = ColumnInfo(name="c", type="int", description="d", nullable=True)
    assert col.key_type is None
    assert col.domain is None
    assert col.notes is None
    assert col.examples is None


def test_column_domain_master() -> None:
    domain = ColumnDomainMaster(master_table="m", master_column="mc", label_column="lc")
    col = ColumnInfo(name="c", type="varchar", description="d", nullable=False, domain=domain)
    assert isinstance(col.domain, ColumnDomainMaster)
    assert col.domain.master_table == "m"


def test_column_domain_values() -> None:
    domain = ColumnDomainValues(values=["a", "b", "c"])
    col = ColumnInfo(name="c", type="varchar", description="d", nullable=False, domain=domain)
    assert isinstance(col.domain, ColumnDomainValues)
    assert col.domain.values == ["a", "b", "c"]


def test_column_info_missing_required() -> None:
    with pytest.raises(ValidationError):
        ColumnInfo(name="c", type="int", nullable=True)  # type: ignore[call-arg]


# --- ConditionalKeyType / key_types tests ---


def test_conditional_key_type_basic() -> None:
    kt = ConditionalKeyType(value="統合会員番号", condition="member_type = '正会員'")
    assert kt.value == "統合会員番号"
    assert kt.condition == "member_type = '正会員'"


def test_conditional_key_type_no_condition() -> None:
    kt = ConditionalKeyType(value="統合会員番号")
    assert kt.value == "統合会員番号"
    assert kt.condition is None


def test_column_info_with_key_types() -> None:
    col = ColumnInfo(
        name="member_code",
        type="varchar(20)",
        description="会員コード",
        nullable=False,
        key_types=[
            ConditionalKeyType(value="統合会員番号", condition="member_type = '正会員'"),
            ConditionalKeyType(value="仮会員番号", condition="member_type = '仮会員'"),
        ],
    )
    assert col.key_type is None
    assert col.key_types is not None
    assert len(col.key_types) == 2
    assert col.key_types[0].value == "統合会員番号"


def test_key_type_and_key_types_exclusive() -> None:
    with pytest.raises(ValidationError, match="mutually exclusive"):
        ColumnInfo(
            name="c",
            type="varchar",
            description="d",
            nullable=False,
            key_type="テスト",
            key_types=[ConditionalKeyType(value="テスト")],
        )


def test_column_info_no_key_types() -> None:
    col = ColumnInfo(name="c", type="int", description="d", nullable=True)
    assert col.key_types is None


# --- Term models ---


# --- Statistics additional tests ---


def test_statistics_additional_with_values() -> None:
    """additional に任意キー・値ペアを指定してインスタンス化できる。"""
    stats = Statistics(
        row_count=100,
        additional={"avg_basket_size": 3.2, "active_rate": 0.85},
    )
    assert stats.additional == {"avg_basket_size": 3.2, "active_rate": 0.85}


def test_statistics_additional_default() -> None:
    """additional 未指定時にデフォルト {} となる。"""
    stats = Statistics(row_count=100)
    assert stats.additional == {}


def test_statistics_additional_various_types() -> None:
    """数値・文字列・配列・ネスト等、異なる型の値を格納できる。"""
    stats = Statistics(
        additional={
            "count": 42,
            "label": "テスト",
            "tags": ["a", "b", "c"],
            "nested": {"key": "value"},
        },
    )
    assert stats.additional["count"] == 42
    assert stats.additional["label"] == "テスト"
    assert stats.additional["tags"] == ["a", "b", "c"]
    assert stats.additional["nested"] == {"key": "value"}


def test_term_value() -> None:
    tv = TermValue(label="レギュラー", description="基本ランク")
    assert tv.label == "レギュラー"
    assert tv.description == "基本ランク"


def test_term_index_required_fields() -> None:
    idx = TermIndex(name="統合会員ID", summary="統合顧客ID体系")
    assert idx.name == "統合会員ID"
    assert idx.summary == "統合顧客ID体系"


def test_term_index_missing_field() -> None:
    with pytest.raises(ValidationError):
        TermIndex(name="統合会員ID")  # type: ignore[call-arg]


def test_term_detail_all_fields() -> None:
    detail = TermDetail(
        name="ロイヤルティランク",
        aliases=["ロイヤルティランク", "Loyalty Rank"],
        definition="顧客ロイヤルティランク",
        related_terms=["統合会員ID"],
        values=[
            TermValue(label="レギュラー", description="基本ランク"),
            TermValue(label="シルバー", description="年間購買額XX万円以上"),
        ],
    )
    assert detail.name == "ロイヤルティランク"
    assert len(detail.aliases) == 2
    assert detail.related_terms == ["統合会員ID"]
    assert detail.values is not None
    assert len(detail.values) == 2


def test_term_detail_minimal() -> None:
    detail = TermDetail(
        name="統合会員ID",
        aliases=["統合会員ID"],
        definition="統合顧客ID体系",
    )
    assert detail.related_terms is None
    assert detail.values is None
