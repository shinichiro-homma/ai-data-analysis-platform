from __future__ import annotations

from pathlib import PurePosixPath
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

BULK_REQUEST_MAX = 100

BulkNameList = Annotated[list[str], Field(min_length=1, max_length=BULK_REQUEST_MAX)]


def _strip_string(v: Any) -> Any:
    """文字列フィールドの前後空白を除去する共通バリデータ。"""
    if isinstance(v, str):
        return v.strip()
    return v


def _validate_relative_path(v: Any) -> Any:
    """パストラバーサル防止: 相対パスのみ許可し '..' セグメントを拒否する。"""
    if isinstance(v, str):
        path = PurePosixPath(v)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"Invalid file_path: '{v}' must be a relative path without '..'")
    return v


# --- Column domain models ---


class ColumnDomainMaster(BaseModel):
    """マスタ参照型ドメイン"""

    master_table: str
    master_column: str
    label_column: str


class ColumnDomainValues(BaseModel):
    """直接列挙型ドメイン"""

    values: list[str]


# --- Column / Table models ---


class ConditionalKeyType(BaseModel):
    """条件付きキー種別"""

    value: str
    condition: str | None = None


class ColumnInfo(BaseModel):
    name: str
    type: str
    description: str
    nullable: bool
    key_type: str | None = None
    key_types: list[ConditionalKeyType] | None = None
    domain: ColumnDomainMaster | ColumnDomainValues | None = None
    notes: str | None = None
    examples: list[str | int | float] | None = None

    _strip_notes = field_validator("notes", mode="before")(_strip_string)

    @model_validator(mode="after")
    def _check_key_type_exclusivity(self) -> ColumnInfo:
        if self.key_type is not None and self.key_types is not None:
            raise ValueError("key_type and key_types are mutually exclusive")
        return self


class DataSource(BaseModel):
    type: Literal["postgresql", "csv", "external"]
    table: str | None = None
    file_path: str | None = None
    encoding: str | None = None
    format: str | None = None
    description: str | None = None

    _validate_file_path = field_validator("file_path", mode="before")(_validate_relative_path)


class DateRange(BaseModel):
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None

    model_config = {"populate_by_name": True}


class Statistics(BaseModel):
    """基本統計量"""

    row_count: int | None = None
    date_range: DateRange | None = None
    update_frequency: str | None = None
    additional: dict[str, Any] = Field(default_factory=dict)


# --- API response models ---


class TableIndex(BaseModel):
    table_name: str
    display_name: str
    summary: str
    category: str


class TableDetail(BaseModel):
    table_name: str
    display_name: str
    description: str
    data_source: DataSource | None = None
    columns: list[ColumnInfo]
    statistics: Statistics | None = None
    notes_table_level: list[str] | None = None

    _strip_description = field_validator("description", mode="before")(_strip_string)


# --- Request models ---


class TableDetailRequest(BaseModel):
    """テーブル詳細一括取得リクエスト"""

    table_names: BulkNameList


class TermDetailRequest(BaseModel):
    """用語詳細一括取得リクエスト"""

    term_names: BulkNameList


class LogicMetaRequest(BaseModel):
    """ロジックメタ一括取得リクエスト"""

    logic_names: BulkNameList


# --- Term models ---


class TermValue(BaseModel):
    """用語の値の体系（ランク区分、コード値等）"""

    label: str
    description: str


class TermIndex(BaseModel):
    """用語インデックス（一覧表示用）"""

    name: str
    summary: str


class TermDetail(BaseModel):
    """用語詳細"""

    name: str
    aliases: list[str]
    definition: str
    related_terms: list[str] | None = None
    values: list[TermValue] | None = None


# --- Logic models ---


class LogicIndex(BaseModel):
    """ロジックインデックス（一覧表示用）"""

    logic_name: str
    summary: str
    category: str


class LogicMeta(BaseModel):
    """ロジックメタ情報"""

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

    _validate_file_path = field_validator("file_path", mode="before")(_validate_relative_path)

    _strip_description = field_validator("description", mode="before")(_strip_string)
    _strip_notes = field_validator("notes", mode="before")(_strip_string)
    _strip_output_description = field_validator("output_description", mode="before")(_strip_string)
    _strip_usage_context = field_validator("usage_context", mode="before")(_strip_string)
