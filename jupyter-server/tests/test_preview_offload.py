"""ContentsPreviewHandler の同期 I/O オフロードテスト

タスク 23.2: _preview_file_sync 関数の抽出と ContentsPreviewHandler.get の async 化を検証する。

テスト対象（いずれも handlers.py に追加予定 / 変更予定）:
- _preview_file_sync(abs_path, file_format, head_rows): ファイルプレビューを同期実行（未実装）
- ContentsPreviewHandler.get: async def に変更し run_in_executor 経由で呼び出す（未実装）

Red フェーズ: _preview_file_sync は未実装のため失敗。get が async でないため失敗。
"""

import csv as _csv
import importlib.util
import inspect
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# =============================================================================
# pandas / pyarrow / numpy のモック
# =============================================================================
# テスト環境（ホスト）にはこれらのライブラリがないため、
# _preview_file_sync が内部で使う pandas.read_csv / pyarrow.parquet.ParquetFile を
# モックで代替する。CSV テストは stdlib csv で実ファイルを読み、
# Parquet テストはレジストリに登録したデータを返す。


class _MockSeries:
    """pandas Series のモック（dtype 参照用）"""

    def __init__(self, dtype="object"):
        self.dtype = dtype


class _MockRow:
    """DataFrame の行のモック"""

    def __init__(self, data: dict):
        self._data = data

    def __getitem__(self, key):
        return self._data[key]


class _MockDataFrame:
    """pandas DataFrame のモック"""

    def __init__(self, data: dict, dtypes: dict | None = None):
        self._data = data
        self.columns = list(data.keys())
        self._dtypes = dtypes or {col: "object" for col in self.columns}

    def __getitem__(self, col):
        return _MockSeries(self._dtypes.get(col, "object"))

    def iterrows(self):
        if not self._data or not self.columns:
            return
        n = len(self._data[self.columns[0]])
        for i in range(n):
            row = _MockRow({col: self._data[col][i] for col in self.columns})
            yield i, row

    def head(self, n):
        new_data = {col: vals[:n] for col, vals in self._data.items()}
        return _MockDataFrame(new_data, self._dtypes)


def _mock_read_csv(path, nrows=None, **kwargs):
    """CSV ファイルを stdlib csv で読み _MockDataFrame を返す"""
    with open(str(path), encoding="utf-8") as f:
        reader = _csv.DictReader(f)
        rows = []
        for i, row in enumerate(reader):
            if nrows is not None and i >= nrows:
                break
            rows.append(dict(row))
    if rows:
        data = {key: [r[key] for r in rows] for key in rows[0]}
    else:
        with open(str(path), encoding="utf-8") as f:
            header = next(_csv.reader(f))
            data = {col: [] for col in header}
    return _MockDataFrame(data)


class _MockParquetMetadata:
    """ParquetFile.metadata のモック"""

    def __init__(self, num_rows: int):
        self.num_rows = num_rows


class _MockTable:
    """pyarrow Table のモック"""

    def __init__(self, df: _MockDataFrame):
        self._df = df

    def to_pandas(self):
        return self._df


class _MockParquetFile:
    """pyarrow.parquet.ParquetFile のモック

    テストごとに register() でデータを登録し、ParquetFile(path) で取得する。
    """

    _files: dict = {}

    def __init__(self, path):
        path_str = str(path)
        if path_str in _MockParquetFile._files:
            data, num_rows = _MockParquetFile._files[path_str]
            self.metadata = _MockParquetMetadata(num_rows)
            self._df = _MockDataFrame(data)
        else:
            self.metadata = _MockParquetMetadata(0)
            self._df = _MockDataFrame({})

    def read_row_group(self, i):
        return _MockTable(self._df)

    @classmethod
    def register(cls, path: str, data: dict, num_rows: int):
        cls._files[str(path)] = (data, num_rows)

    @classmethod
    def clear(cls):
        cls._files.clear()


# =============================================================================
# モジュールのセットアップ
# =============================================================================
# custom_api パッケージの __init__.py を経由せず、handlers.py を単体ロードする。
# Tornado/jupyter_server 等の外部依存はモックで置き換える
# （test_kernel_executor_serialization.py:28-72 のパターンを踏襲）

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


def _ensure_mock_module(name: str, **attrs) -> _types.ModuleType:
    """sys.modules にモックモジュールを登録（未登録の場合のみ）"""
    if name not in sys.modules:
        mod = _types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


def _load_module(name: str, filename: str) -> _types.ModuleType:
    """extensions/custom_api/ 配下のモジュールをファイルからロード"""
    sys.modules.pop(name, None)
    path = _ext_dir / "custom_api" / filename
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# 1. custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# 2. 外部依存のモック
_ensure_mock_module("jupyter_server")
_ensure_mock_module("jupyter_server.base")
_ensure_mock_module(
    "jupyter_server.base.handlers",
    APIHandler=type("APIHandler", (), {}),
    JupyterHandler=type("JupyterHandler", (), {}),
)
_ensure_mock_module("tornado")
_ensure_mock_module("tornado.web", authenticated=lambda f: f)
# test_ai_events.py が実 tornado をインポート済みの場合、authenticated を強制上書き
sys.modules["tornado.web"].authenticated = lambda f: f
_ensure_mock_module("sqlalchemy")
_ensure_mock_module("sqlalchemy.exc", OperationalError=Exception, ProgrammingError=Exception)

# numpy モック（_serialize_value が isinstance チェックに使用）
_np_mock = _ensure_mock_module("numpy")
_np_mock.integer = type("np_integer", (int,), {})
_np_mock.floating = type("np_floating", (float,), {})
_np_mock.bool_ = type("np_bool_", (), {})

# pandas モック（_preview_file_sync が内部で import する）
_pd_mock = _ensure_mock_module("pandas")
_pd_mock.read_csv = _mock_read_csv
_pd_mock.DataFrame = _MockDataFrame

# pyarrow モックはモジュールレベルでは登録しない（test_sql_handlers の pyarrow モックと干渉するため）。
# Parquet テストクラスのフィクスチャで一時的にインストールする。

# 3. base.py のロード（BaseCustomHandler, JUPYTER_ROOT_DIR 等の実モジュール）
base_mod = _load_module("custom_api.base", "base.py")


# 4. handlers.py がインポートするサブモジュールのモック
def _ensure_ca(name, **attrs):
    return _ensure_mock_module(f"custom_api.{name}", __package__="custom_api", **attrs)


_ensure_ca(
    "ai_events",
    AiEventsPostHandler=type("AiEventsPostHandler", (), {}),
    AiEventsWebSocketHandler=type("AiEventsWebSocketHandler", (), {}),
)
_ensure_ca("code_validator", validate_code=lambda *a, **kw: None)
_ensure_ca("kernel_executor", KernelExecutor=type("KernelExecutor", (), {}))
_ensure_ca("lock_handlers", NotebookLocksHandler=type("NotebookLocksHandler", (), {}))
_ensure_ca(
    "session_handlers",
    CustomSessionsHandler=type("CustomSessionsHandler", (), {}),
    get_kernel_workspace=lambda *a, **kw: None,
    unregister_kernel=lambda *a, **kw: None,
)
_ensure_ca(
    "sql_handlers",
    SqlExecuteHandler=type("SqlExecuteHandler", (), {}),
    SqlExportHandler=type("SqlExportHandler", (), {}),
)
_ensure_ca(
    "workspace_handlers",
    WorkspaceHandler=type("WorkspaceHandler", (), {}),
    WorkspacesHandler=type("WorkspacesHandler", (), {}),
    WorkspaceSummarizeHandler=type("WorkspaceSummarizeHandler", (), {}),
)
_ensure_ca("notebook_locks", lock_token_ctx=MagicMock())

# 5. handlers.py のロード
handlers_mod = _load_module("custom_api.handlers", "handlers.py")

ContentsPreviewHandler = handlers_mod.ContentsPreviewHandler
# _preview_file_sync は未実装なので getattr でフォールバック
_preview_file_sync = getattr(handlers_mod, "_preview_file_sync", None)


# =============================================================================
# フィクスチャ
# =============================================================================


@pytest.fixture()
def mock_pyarrow():
    """Parquet テスト用に pyarrow を一時的にモック登録し、終了後に復元する。

    test_sql_handlers の pyarrow モックと干渉しないよう、テスト単位で
    インストール → 復元する。
    """
    pa_mock = _types.ModuleType("pyarrow")
    pq_mock = _types.ModuleType("pyarrow.parquet")
    pq_mock.ParquetFile = _MockParquetFile
    pa_mock.parquet = pq_mock

    old_pa = sys.modules.get("pyarrow")
    old_pq = sys.modules.get("pyarrow.parquet")
    sys.modules["pyarrow"] = pa_mock
    sys.modules["pyarrow.parquet"] = pq_mock
    _MockParquetFile.clear()
    yield
    _MockParquetFile.clear()
    if old_pa is not None:
        sys.modules["pyarrow"] = old_pa
    else:
        sys.modules.pop("pyarrow", None)
    if old_pq is not None:
        sys.modules["pyarrow.parquet"] = old_pq
    else:
        sys.modules.pop("pyarrow.parquet", None)


# =============================================================================
# テスト
# =============================================================================


class TestPreviewFileSyncCsv:
    """_preview_file_sync の CSV 処理テスト（完了条件 4）"""

    def test_csv_returns_correct_columns_and_head(self, tmp_path: Path):
        """CSV ファイルのカラム情報と先頭行が正しく返される"""
        assert _preview_file_sync is not None, "_preview_file_sync is not yet implemented"

        # Arrange
        csv_path = tmp_path / "test.csv"
        csv_path.write_text("name,age\nAlice,30\nBob,25\nCharlie,35\n", encoding="utf-8")

        # Act
        result = _preview_file_sync(str(csv_path), "csv", 2)

        # Assert
        assert result["format"] == "csv"
        assert len(result["columns"]) == 2
        col_names = [c["name"] for c in result["columns"]]
        assert "name" in col_names
        assert "age" in col_names
        assert len(result["head"]) == 2
        assert result["head"][0]["name"] == "Alice"
        assert result["file_size_bytes"] > 0

    def test_csv_row_count_excludes_header(self, tmp_path: Path):
        """CSV の行数カウントがヘッダー行を除外している"""
        assert _preview_file_sync is not None, "_preview_file_sync is not yet implemented"

        # Arrange: 10 データ行 + ヘッダー行
        lines = ["x\n"] + [f"{i}\n" for i in range(10)]
        csv_path = tmp_path / "data.csv"
        csv_path.write_text("".join(lines), encoding="utf-8")

        # Act
        result = _preview_file_sync(str(csv_path), "csv", 5)

        # Assert
        assert result["row_count"] == 10


class TestPreviewFileSyncParquet:
    """_preview_file_sync の Parquet 処理テスト（完了条件 4）"""

    def test_parquet_returns_correct_columns_and_head(self, mock_pyarrow, tmp_path: Path):
        """Parquet ファイルのカラム情報と先頭行が正しく返される"""
        assert _preview_file_sync is not None, "_preview_file_sync is not yet implemented"

        # Arrange
        pq_path = tmp_path / "test.parquet"
        pq_path.write_bytes(b"PAR1dummy")  # ダミーファイル（file_size_bytes 用）
        _MockParquetFile.register(
            str(pq_path),
            {"col_a": ["1", "2", "3"], "col_b": ["x", "y", "z"]},
            3,
        )

        # Act
        result = _preview_file_sync(str(pq_path), "parquet", 2)

        # Assert
        assert result["format"] == "parquet"
        assert len(result["columns"]) == 2
        col_names = [c["name"] for c in result["columns"]]
        assert "col_a" in col_names
        assert "col_b" in col_names
        assert len(result["head"]) == 2
        assert result["row_count"] == 3
        assert result["file_size_bytes"] > 0


class TestPreviewHandlerIsAsync:
    """ContentsPreviewHandler.get が async def であることの検証（完了条件 1）"""

    def test_get_is_coroutine_function(self):
        """get メソッドが coroutine function（async def）である"""
        assert inspect.iscoroutinefunction(ContentsPreviewHandler.get), "ContentsPreviewHandler.get should be async def"
