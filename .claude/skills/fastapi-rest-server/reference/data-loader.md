## データローダー

### CatalogStore のパターン

`CatalogStore` はインメモリの辞書でデータを保持する。共通の `_load_resource()` メソッドでインデックスと詳細の読み込みを一般化する。

#### YAML 読み込みユーティリティ

```python
import yaml
from pathlib import Path
from typing import Any

def _load_yaml(yaml_path: Path) -> dict[str, Any] | list[Any] | None:
    """YAMLファイルを読み込み、パース結果を返す。"""
    try:
        with open(yaml_path, encoding="utf-8") as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as exc:
        raise ValueError(
            f"YAML syntax error in {yaml_path.name}: {exc}"
        ) from exc


def _load_and_validate_yaml(
    yaml_path: Path, required_key: str
) -> dict[str, Any] | None:
    """YAMLを読み込み、辞書型かつ必須キーが存在するか検証する。"""
    data = _load_yaml(yaml_path)
    if not isinstance(data, dict) or required_key not in data:
        logger.warning(
            "Skipping %s: '%s' not defined", yaml_path.name, required_key
        )
        return None
    return data
```

#### ストアクラス

```python
class CatalogStore:
    """テーブルカタログと用語集をインメモリで保持するストア"""

    def __init__(self) -> None:
        self._indexes: dict[str, TableIndex] = {}
        self._details: dict[str, TableDetail] = {}
        self._term_indexes: dict[str, TermIndex] = {}
        self._term_details: dict[str, TermDetail] = {}
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
```

#### 一括検索ヘルパー（found / not_found 分離）

```python
    @staticmethod
    def _lookup_many(
        store: dict[str, _T], names: list[str]
    ) -> tuple[list[_T], list[str]]:
        """名前リストから辞書を引き、found/not_found に振り分ける。"""
        found: list[_T] = []
        not_found: list[str] = []
        for name in names:
            item = store.get(name)
            if item is not None:
                found.append(item)
            else:
                not_found.append(name)
        return found, not_found
```

#### リソース読み込みの共通処理

インデックスと詳細の読み込みロジックを一般化したメソッド。テーブル・用語・ロジックの全てで同じパターンを使う。

```python
    def _load_resource(
        self,
        data_dir: Path,
        sub_dir: str,
        detail_dir: str,
        index_key: str,
        id_field: str,
        parse_index: Callable[[dict[str, Any]], _T],
        parse_detail: Callable[[dict[str, Any]], _T],
        resource_label: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """インデックスと詳細を読み込む共通処理。"""
        base_dir = data_dir / sub_dir
        index_path = base_dir / "index.yaml"
        details_path = base_dir / detail_dir

        # インデックス読み込み
        indexes: dict[str, Any] = {}
        if index_path.is_file():
            data = _load_yaml(index_path)
            if isinstance(data, dict) and index_key in data:
                for raw in data[index_key]:
                    name = raw.get(id_field)
                    if name:
                        indexes[name] = parse_index(raw)

        # 詳細読み込み
        details: dict[str, Any] = {}
        if details_path.is_dir():
            for yaml_path in sorted(details_path.glob("*.yaml")):
                validated = _load_and_validate_yaml(yaml_path, id_field)
                if validated is None:
                    continue
                name = validated[id_field]
                details[name] = parse_detail(validated)

        # 整合性チェック: インデックスにあるが詳細がないものを警告
        for name in indexes:
            if name not in details:
                logger.warning(
                    "%s '%s' is in index but has no detail YAML",
                    resource_label.capitalize(), name
                )

        return indexes, details
```

#### リソース種別ごとの読み込みメソッド

```python
    def load_all(self, data_dir: Path) -> dict[str, int]:
        """全リソースを読み込む。"""
        return {
            "tables": self.load_tables(data_dir),
            "terms": self.load_terms(data_dir),
            "logic": self.load_logic(data_dir),
        }

    def load_tables(self, data_dir: Path) -> int:
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
        self._indexes = indexes
        self._details = details
        return len(indexes)
```
