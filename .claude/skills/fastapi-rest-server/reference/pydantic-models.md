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
