from __future__ import annotations

import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

import yaml

from .models import (
    ColumnDomainMaster,
    ColumnDomainValues,
    ColumnInfo,
    ConditionalKeyType,
    DataSource,
    DateRange,
    LogicIndex,
    LogicMeta,
    Statistics,
    TableDetail,
    TableIndex,
    TermDetail,
    TermIndex,
    TermValue,
)

_IndexT = TypeVar("_IndexT")
_DetailT = TypeVar("_DetailT")

logger = logging.getLogger(__name__)


class LogicCodeNotFoundError(Exception):
    """ロジックは存在するがコードファイルが見つからない場合の例外。"""


def _load_yaml(yaml_path: Path) -> dict[str, Any] | list[Any] | None:
    """YAMLファイルを読み込み、パース結果を返す。"""
    try:
        with open(yaml_path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML syntax error in {yaml_path.name}: {exc}") from exc


def _load_and_validate_yaml(yaml_path: Path, required_key: str) -> dict[str, Any] | None:
    """YAMLを読み込み、辞書型かつ必須キーが存在するか検証する。

    Returns:
        検証済みの辞書。不正な場合は None を返しログ警告を出力する。
    """
    data = _load_yaml(yaml_path)
    if not isinstance(data, dict) or required_key not in data:
        logger.warning("Skipping %s: '%s' not defined", yaml_path.name, required_key)
        return None
    return data


def _parse_domain(
    domain_data: dict[str, Any] | None,
) -> ColumnDomainMaster | ColumnDomainValues | None:
    if domain_data is None:
        return None
    try:
        if "values" in domain_data:
            return ColumnDomainValues(values=domain_data["values"])
        if "master_table" in domain_data:
            return ColumnDomainMaster(
                master_table=domain_data["master_table"],
                master_column=domain_data["master_column"],
                label_column=domain_data["label_column"],
            )
    except KeyError as exc:
        raise ValueError(f"Missing required field {exc} in domain definition") from exc
    return None


def _parse_key_types(
    data: list[dict[str, Any]] | None,
) -> list[ConditionalKeyType] | None:
    if data is None:
        return None
    try:
        return [ConditionalKeyType(value=item["value"], condition=item.get("condition")) for item in data]
    except KeyError as exc:
        raise ValueError(f"Missing required field {exc} in key_types definition") from exc


def _parse_column(column_data: dict[str, Any]) -> ColumnInfo:
    try:
        domain = _parse_domain(column_data.get("domain"))
        key_types = _parse_key_types(column_data.get("key_types"))
        return ColumnInfo(
            name=column_data["name"],
            type=column_data["type"],
            description=column_data["description"],
            nullable=column_data["nullable"],
            key_type=column_data.get("key_type"),
            key_types=key_types,
            domain=domain,
            notes=column_data.get("notes"),
            examples=column_data.get("examples"),
        )
    except KeyError as exc:
        raise ValueError(f"Missing required field {exc} in column definition") from exc


_KNOWN_STATISTICS_FIELDS = {"row_count", "date_range", "update_frequency"}


def _parse_statistics(stats_data: dict[str, Any] | None) -> Statistics | None:
    if stats_data is None:
        return None
    date_range = None
    if "date_range" in stats_data:
        date_range = DateRange(**stats_data["date_range"])
    additional = {k: v for k, v in stats_data.items() if k not in _KNOWN_STATISTICS_FIELDS}
    return Statistics(
        row_count=stats_data.get("row_count"),
        date_range=date_range,
        update_frequency=stats_data.get("update_frequency"),
        additional=additional,
    )


def _parse_table_detail(table_data: dict[str, Any]) -> TableDetail:
    """テーブル詳細YAMLからTableDetailを生成する。"""
    try:
        columns = [_parse_column(c) for c in table_data.get("columns", [])]
        data_source = None
        if "data_source" in table_data:
            data_source = DataSource(**table_data["data_source"])
        statistics = _parse_statistics(table_data.get("statistics"))

        return TableDetail(
            table_name=table_data["table_name"],
            display_name=table_data["display_name"],
            description=table_data.get("description", ""),
            data_source=data_source,
            columns=columns,
            statistics=statistics,
            notes_table_level=table_data.get("notes_table_level"),
        )
    except KeyError as exc:
        table_name = table_data.get("table_name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in table '{table_name}'") from exc


def _parse_table_index(entry: dict[str, Any]) -> TableIndex:
    """index.yamlのエントリからTableIndexを生成する。"""
    try:
        return TableIndex(
            table_name=entry["table_name"],
            display_name=entry["display_name"],
            summary=entry["summary"],
            category=entry["category"],
        )
    except KeyError as exc:
        table_name = entry.get("table_name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in table index entry '{table_name}'") from exc


def _parse_term_value(value_data: dict[str, Any]) -> TermValue:
    try:
        return TermValue(label=value_data["label"], description=value_data["description"])
    except KeyError as exc:
        raise ValueError(f"Missing required field {exc} in term value") from exc


def _parse_term_index(entry: dict[str, Any]) -> TermIndex:
    """index.yamlのエントリからTermIndexを生成する。"""
    try:
        return TermIndex(
            name=entry["name"],
            summary=entry["summary"],
        )
    except KeyError as exc:
        term_name = entry.get("name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in term index entry '{term_name}'") from exc


def _parse_term_detail(term_data: dict[str, Any]) -> TermDetail:
    """個別用語YAMLからTermDetailを生成する。"""
    try:
        values = None
        if "values" in term_data and term_data["values"] is not None:
            values = [_parse_term_value(v) for v in term_data["values"]]

        return TermDetail(
            name=term_data["name"],
            aliases=term_data.get("aliases", []),
            definition=term_data.get("definition", ""),
            related_terms=term_data.get("related_terms"),
            values=values,
        )
    except KeyError as exc:
        term_name = term_data.get("name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in term '{term_name}'") from exc


def _parse_logic_index(entry: dict[str, Any]) -> LogicIndex:
    """index.yamlのエントリからLogicIndexを生成する。"""
    try:
        return LogicIndex(
            logic_name=entry["logic_name"],
            summary=entry["summary"],
            category=entry["category"],
        )
    except KeyError as exc:
        logic_name = entry.get("logic_name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in logic index entry '{logic_name}'") from exc


def _parse_logic_meta(meta_data: dict[str, Any]) -> LogicMeta:
    """個別ロジックメタYAMLからLogicMetaを生成する。"""
    try:
        return LogicMeta(
            logic_name=meta_data["logic_name"],
            description=meta_data.get("description", ""),
            file_path=meta_data["file_path"],
            language=meta_data["language"],
            usage_type=meta_data["usage_type"],
            input_tables=meta_data.get("input_tables", []),
            output_description=meta_data.get("output_description", ""),
            usage_context=meta_data.get("usage_context"),
            related_logic=meta_data.get("related_logic"),
            notes=meta_data.get("notes"),
        )
    except KeyError as exc:
        logic_name = meta_data.get("logic_name", "<unknown>")
        raise ValueError(f"Missing required field {exc} in logic '{logic_name}'") from exc


class CatalogStore:
    """テーブルカタログと用語集をインメモリで保持するストア"""

    def __init__(self) -> None:
        self._indexes: dict[str, TableIndex] = {}
        self._details: dict[str, TableDetail] = {}
        self._term_indexes: dict[str, TermIndex] = {}
        self._term_details: dict[str, TermDetail] = {}
        self._term_search_index: dict[str, list[str]] = {}
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

    def get_all_indexes(self) -> list[TableIndex]:
        return list(self._indexes.values())

    def get_detail(self, table_name: str) -> TableDetail | None:
        return self._details.get(table_name)

    @staticmethod
    def _lookup_many(store: dict[str, _IndexT], names: list[str]) -> tuple[list[_IndexT], list[str]]:
        """名前リストから辞書を引き、found/not_found に振り分ける。"""
        found: list[_IndexT] = []
        not_found: list[str] = []
        for name in names:
            item = store.get(name)
            if item is not None:
                found.append(item)
            else:
                not_found.append(name)
        return found, not_found

    def get_table_details(self, table_names: list[str]) -> tuple[list[TableDetail], list[str]]:
        return self._lookup_many(self._details, table_names)

    def get_all_term_indexes(self) -> list[TermIndex]:
        return list(self._term_indexes.values())

    def search_term_indexes(self, query: str) -> list[TermIndex]:
        """query で用語名・aliases を部分一致検索し、マッチした TermIndex を返す。"""
        q = query.lower()
        results: list[TermIndex] = []
        for name, keywords in self._term_search_index.items():
            if any(q in kw for kw in keywords):
                idx = self._term_indexes.get(name)
                if idx is not None:
                    results.append(idx)
        return results

    def get_term_details(self, term_names: list[str]) -> tuple[list[TermDetail], list[str]]:
        return self._lookup_many(self._term_details, term_names)

    def _load_resource(
        self,
        data_dir: Path,
        sub_dir: str,
        detail_dir: str,
        index_key: str,
        id_field: str,
        parse_index: Callable[[dict[str, Any]], _IndexT],
        parse_detail: Callable[[dict[str, Any]], _DetailT],
        resource_label: str,
    ) -> tuple[dict[str, _IndexT], dict[str, _DetailT]]:
        """インデックスと詳細を読み込む共通処理。

        Returns:
            (インデックス辞書, 詳細辞書)
        """
        base_dir = data_dir / sub_dir
        index_path = base_dir / "index.yaml"
        details_path = base_dir / detail_dir

        # インデックス読み込み
        indexes: dict[str, _IndexT] = {}
        if index_path.is_file():
            data = _load_yaml(index_path)
            if isinstance(data, dict) and index_key in data:
                for raw in data[index_key]:
                    name = raw.get(id_field)
                    if name:
                        indexes[name] = parse_index(raw)
                        logger.info("Loaded %s index: %s", resource_label, name)
        else:
            logger.warning("%s index not found: %s", resource_label.capitalize(), index_path)

        # 詳細読み込み
        details: dict[str, _DetailT] = {}
        if details_path.is_dir():
            for yaml_path in sorted(details_path.glob("*.yaml")):
                validated = _load_and_validate_yaml(yaml_path, id_field)
                if validated is None:
                    continue
                name = validated[id_field]
                details[name] = parse_detail(validated)
                logger.info("Loaded %s detail: %s (%s)", resource_label, name, yaml_path.name)
        else:
            logger.warning("%s directory not found: %s", resource_label.capitalize(), details_path)

        # 整合性チェック
        for name in indexes:
            if name not in details:
                logger.warning("%s '%s' is in index but has no detail YAML", resource_label.capitalize(), name)

        logger.info(
            "Total %ss loaded: %d indexes, %d details",
            resource_label,
            len(indexes),
            len(details),
        )
        return indexes, details

    def load_all(self, data_dir: Path) -> dict[str, int]:
        """全リソース（テーブル、用語、ロジック）を読み込む。"""
        return {
            "tables": self.load_tables(data_dir),
            "terms": self.load_terms(data_dir),
            "logic": self.load_logic(data_dir),
        }

    @staticmethod
    def _load_external_tables(
        data_dir: Path,
    ) -> tuple[dict[str, TableIndex], dict[str, TableDetail]]:
        """catalog/external/ から外部テーブル定義を読み込む。"""
        indexes: dict[str, TableIndex] = {}
        details: dict[str, TableDetail] = {}
        external_dir = data_dir / "catalog" / "external"
        if not external_dir.is_dir():
            return indexes, details
        for yaml_file in sorted(external_dir.glob("*.yaml")):
            validated = _load_and_validate_yaml(yaml_file, "table_name")
            if validated is None:
                continue
            name = validated["table_name"]
            indexes[name] = _parse_table_index(validated)
            details[name] = _parse_table_detail(validated)
            logger.info("Loaded external table: %s (%s)", name, yaml_file.name)
        return indexes, details

    def load_tables(self, data_dir: Path) -> int:
        """data_dir/catalog/ からインデックスと詳細を読み込む。"""
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

        # catalog/external/ からも読み込み
        ext_indexes, ext_details = self._load_external_tables(data_dir)
        indexes.update(ext_indexes)
        details.update(ext_details)

        self._indexes = indexes
        self._details = details
        return len(indexes)

    def load_terms(self, data_dir: Path) -> int:
        """data_dir/glossary/ からインデックスと詳細を読み込む。"""
        indexes, details = self._load_resource(
            data_dir=data_dir,
            sub_dir="glossary",
            detail_dir="terms",
            index_key="terms_index",
            id_field="name",
            parse_index=_parse_term_index,
            parse_detail=_parse_term_detail,
            resource_label="term",
        )
        self._term_indexes = indexes
        self._term_details = details
        self._build_term_search_index()
        return len(indexes)

    def _build_term_search_index(self) -> None:
        """全用語詳細から aliases と related_terms を読み込み、検索インデックスを構築する。"""
        index: dict[str, list[str]] = {}
        for name, detail in self._term_details.items():
            keywords: set[str] = {name.lower()}
            for term in detail.aliases + (detail.related_terms or []):
                keywords.add(term.lower())
            index[name] = list(keywords)
        self._term_search_index = index
        logger.info("Term search index built: %d entries", len(index))

    def load_logic(self, data_dir: Path) -> int:
        """data_dir/logic/ からインデックスとメタ情報を読み込む。"""
        self._data_dir = data_dir
        indexes, metas = self._load_resource(
            data_dir=data_dir,
            sub_dir="logic",
            detail_dir="meta",
            index_key="logic_index",
            id_field="logic_name",
            parse_index=_parse_logic_index,
            parse_detail=_parse_logic_meta,
            resource_label="logic",
        )
        self._logic_indexes = indexes
        self._logic_metas = metas
        return len(indexes)

    def get_all_logic_indexes(self) -> list[LogicIndex]:
        return list(self._logic_indexes.values())

    def get_logic_metas(self, logic_names: list[str]) -> tuple[list[LogicMeta], list[str]]:
        return self._lookup_many(self._logic_metas, logic_names)

    def get_logic_code(self, logic_name: str) -> dict[str, str] | None:
        """ロジックのコードファイル内容を取得する。

        Returns:
            {"logic_name": ..., "language": ..., "code": ...}
            ロジック自体が存在しない場合は None。

        Raises:
            LogicCodeNotFoundError: ロジックは存在するがコードファイルが見つからない場合。
        """
        meta = self._logic_metas.get(logic_name)
        if meta is None:
            return None

        if self._data_dir is None:
            raise LogicCodeNotFoundError(f"Code file for logic '{logic_name}' not found: data_dir not set")

        code_path = (self._data_dir / meta.file_path).resolve()
        base_path = self._data_dir.resolve()

        # パストラバーサル防止
        if not code_path.is_relative_to(base_path):
            logger.warning(
                "Path traversal attempt detected for logic '%s': %s",
                logic_name,
                meta.file_path,
            )
            raise LogicCodeNotFoundError(f"Code file for logic '{logic_name}' not found")

        if not code_path.is_file():
            raise LogicCodeNotFoundError(f"Code file for logic '{logic_name}' not found: {meta.file_path}")

        try:
            code = code_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.error("Failed to read code file for '%s': %s", logic_name, exc)
            raise LogicCodeNotFoundError(f"Code file for logic '{logic_name}' not found") from exc

        return {
            "logic_name": logic_name,
            "language": meta.language,
            "code": code,
        }
