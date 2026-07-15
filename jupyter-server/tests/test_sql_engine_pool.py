"""SQL エンジンのプール化とタイムアウト後の接続解放のテスト

sql_handlers.py のプール化（_get_engine / shutdown_engines）、
sync 関数のシグネチャ変更（engine 引数化）、SET LOCAL の使用、
タイムアウト後の接続解放を検証する。

sql_handlers.py は pandas / sqlalchemy / tornado 等の重い依存を持つため、
パッケージの __init__.py を経由せずにモジュールを直接ロードする。
"""

import importlib.util
import inspect
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


# ── 1. 重い依存のモック ──────────────────────────────


def _ensure_mock_module(name: str, **attrs) -> _types.ModuleType:
    """sys.modules にモックモジュールを登録（未登録の場合のみ）。
    既登録の場合は不足属性のみ補完する。
    """
    if name not in sys.modules:
        mod = _types.ModuleType(name)
        sys.modules[name] = mod
    mod = sys.modules[name]
    for k, v in attrs.items():
        if not hasattr(mod, k):
            setattr(mod, k, v)
    return mod


# pandas
_ensure_mock_module("pandas", DataFrame=MagicMock())

# sqlalchemy: create_engine は呼び出しごとに異なる MagicMock を返す
_ensure_mock_module(
    "sqlalchemy",
    create_engine=MagicMock(side_effect=lambda *a, **kw: MagicMock()),
    text=lambda s: s,
)
_ensure_mock_module(
    "sqlalchemy.exc",
    OperationalError=type("OperationalError", (Exception,), {}),
    ProgrammingError=type("ProgrammingError", (Exception,), {}),
)
sys.modules["sqlalchemy"].exc = sys.modules["sqlalchemy.exc"]

# tornado
_ensure_mock_module("tornado")
_ensure_mock_module("tornado.web", authenticated=lambda f: f)


# ── 2. custom_api パッケージ構造の構築 ───────────────

if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

if "custom_api.base" not in sys.modules:
    _base_mock = _types.ModuleType("custom_api.base")
    _base_mock.__package__ = "custom_api"
    _base_mock.BaseCustomHandler = type("BaseCustomHandler", (), {})
    _base_mock.resolve_workspace_dir = lambda *a, **kw: None
    _base_mock.validate_timeout = lambda *a, **kw: (30, None)
    _base_mock.validate_workspace_id = lambda *a, **kw: None
    _base_mock.workspace_contents_path = lambda *a, **kw: ""
    sys.modules["custom_api.base"] = _base_mock


# ── 3. sql_handlers をパッケージ内モジュールとしてロード ──


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


_sql_handlers = _load_module("custom_api.sql_handlers", "sql_handlers.py")

# テスト対象関数の取得（未実装の関数は None）
_get_engine = getattr(_sql_handlers, "_get_engine", None)
_shutdown_engines = getattr(_sql_handlers, "shutdown_engines", None)
_execute_sql_sync = getattr(_sql_handlers, "_execute_sql_sync", None)
_execute_non_select_sync = getattr(_sql_handlers, "_execute_non_select_sync", None)
_export_sql_sync = getattr(_sql_handlers, "_export_sql_sync", None)


# ── テスト ──────────────────────────────────────────


class TestGetEngine:
    """_get_engine が同じ database_url に対して同一エンジンを返すこと"""

    def test_get_engine_exists(self):
        """_get_engine 関数が存在する"""
        assert _get_engine is not None, "_get_engine が sql_handlers に定義されていない"

    def test_same_url_returns_same_engine(self):
        """同じ URL に対して同一のエンジンオブジェクトを返す（キャッシュ）"""
        if _get_engine is None:
            pytest.fail("_get_engine が未実装")
        engine1 = _get_engine("postgresql://localhost/testdb")
        engine2 = _get_engine("postgresql://localhost/testdb")
        assert engine1 is engine2, "同じ URL に対して異なるエンジンが返された"

    def test_different_url_returns_different_engine(self):
        """異なる URL に対して異なるエンジンを返す"""
        if _get_engine is None:
            pytest.fail("_get_engine が未実装")
        engine1 = _get_engine("postgresql://localhost/db1")
        engine2 = _get_engine("postgresql://localhost/db2")
        assert engine1 is not engine2, "異なる URL に対して同一エンジンが返された"


class TestGetEngineConfig:
    """エンジンの pool 設定が正しいこと"""

    def test_pool_pre_ping_enabled(self):
        """pool_pre_ping=True が設定されている"""
        if _get_engine is None:
            pytest.fail("_get_engine が未実装")
        source = inspect.getsource(_get_engine)
        assert "pool_pre_ping=True" in source, "pool_pre_ping=True が設定されていない"

    def test_pool_size_not_one(self):
        """pool_size が 1 より大きく設定されている"""
        if _get_engine is None:
            pytest.fail("_get_engine が未実装")
        source = inspect.getsource(_get_engine)
        assert "pool_size=1" not in source, "pool_size が 1 のまま"


class TestSyncFunctionsUseSharedEngine:
    """3 つの sync 関数が engine 引数を受け取り、create_engine / dispose を呼ばないこと"""

    def test_execute_sql_sync_first_param_is_engine(self):
        """_execute_sql_sync の第 1 引数が engine である"""
        sig = inspect.signature(_execute_sql_sync)
        first_param = list(sig.parameters.keys())[0]
        assert first_param == "engine", f"第 1 引数が '{first_param}'（期待: 'engine'）"

    def test_execute_non_select_sync_first_param_is_engine(self):
        """_execute_non_select_sync の第 1 引数が engine である"""
        sig = inspect.signature(_execute_non_select_sync)
        first_param = list(sig.parameters.keys())[0]
        assert first_param == "engine", f"第 1 引数が '{first_param}'（期待: 'engine'）"

    def test_export_sql_sync_first_param_is_engine(self):
        """_export_sql_sync の第 1 引数が engine である"""
        sig = inspect.signature(_export_sql_sync)
        first_param = list(sig.parameters.keys())[0]
        assert first_param == "engine", f"第 1 引数が '{first_param}'（期待: 'engine'）"

    def test_execute_sql_sync_no_create_engine(self):
        """_execute_sql_sync 内でエンジン生成を行わない"""
        source = inspect.getsource(_execute_sql_sync)
        assert "_create_sql_engine" not in source, "_create_sql_engine の呼び出しが残っている"
        assert "create_engine(" not in source, "create_engine の直接呼び出しが残っている"

    def test_execute_sql_sync_no_dispose(self):
        """_execute_sql_sync 内で engine.dispose() を呼ばない"""
        source = inspect.getsource(_execute_sql_sync)
        assert ".dispose()" not in source, "engine.dispose() の呼び出しが残っている"

    def test_execute_non_select_sync_no_create_engine(self):
        """_execute_non_select_sync 内でエンジン生成を行わない"""
        source = inspect.getsource(_execute_non_select_sync)
        assert "_create_sql_engine" not in source, "_create_sql_engine の呼び出しが残っている"
        assert "create_engine(" not in source, "create_engine の直接呼び出しが残っている"

    def test_execute_non_select_sync_no_dispose(self):
        """_execute_non_select_sync 内で engine.dispose() を呼ばない"""
        source = inspect.getsource(_execute_non_select_sync)
        assert ".dispose()" not in source, "engine.dispose() の呼び出しが残っている"

    def test_export_sql_sync_no_create_engine(self):
        """_export_sql_sync 内でエンジン生成を行わない"""
        source = inspect.getsource(_export_sql_sync)
        assert "_create_sql_engine" not in source, "_create_sql_engine の呼び出しが残っている"
        assert "create_engine(" not in source, "create_engine の直接呼び出しが残っている"

    def test_export_sql_sync_no_dispose(self):
        """_export_sql_sync 内で engine.dispose() を呼ばない"""
        source = inspect.getsource(_export_sql_sync)
        assert ".dispose()" not in source, "engine.dispose() の呼び出しが残っている"


class TestSetLocalNotSet:
    """SET LOCAL が使われ、セッションレベル SET（LOCAL なし）が使われていないこと"""

    def test_export_sql_sync_uses_set_local_read_only(self):
        """_export_sql_sync が SET LOCAL default_transaction_read_only を使用"""
        source = inspect.getsource(_export_sql_sync)
        assert "SET LOCAL default_transaction_read_only" in source

    def test_export_sql_sync_uses_set_local_timeout(self):
        """_export_sql_sync が SET LOCAL statement_timeout を使用"""
        source = inspect.getsource(_export_sql_sync)
        assert "SET LOCAL statement_timeout" in source

    def test_execute_sql_sync_uses_set_local_read_only(self):
        """_execute_sql_sync が SET LOCAL default_transaction_read_only を使用"""
        source = inspect.getsource(_execute_sql_sync)
        assert "SET LOCAL default_transaction_read_only" in source

    def test_execute_sql_sync_uses_set_local_timeout(self):
        """_execute_sql_sync が SET LOCAL statement_timeout を使用"""
        source = inspect.getsource(_execute_sql_sync)
        assert "SET LOCAL statement_timeout" in source

    def test_execute_non_select_sync_uses_set_local_timeout(self):
        """_execute_non_select_sync が SET LOCAL statement_timeout を使用"""
        source = inspect.getsource(_execute_non_select_sync)
        assert "SET LOCAL statement_timeout" in source

    def test_no_bare_set_in_sync_functions(self):
        """全 sync 関数でセッションレベル SET が使われていない"""
        targets = [
            ("_execute_sql_sync", _execute_sql_sync),
            ("_execute_non_select_sync", _execute_non_select_sync),
            ("_export_sql_sync", _export_sql_sync),
        ]
        for func_name, func in targets:
            source = inspect.getsource(func)
            for line in source.split("\n"):
                stripped = line.strip()
                if stripped.startswith("#"):
                    continue
                if "SET default_transaction_read_only" in stripped and "SET LOCAL" not in stripped:
                    pytest.fail(f"{func_name}: セッションレベル SET が使用されている: {stripped}")
                if "SET statement_timeout" in stripped and "SET LOCAL" not in stripped:
                    pytest.fail(f"{func_name}: セッションレベル SET statement_timeout が使用されている: {stripped}")


class TestTimeoutConnectionRelease:
    """wait_for タイムアウト時に接続がキャンセルされプールに返却されること"""

    def test_cancel_mechanism_in_module(self):
        """モジュール内に接続キャンセル処理（cancel()）が存在する"""
        source = inspect.getsource(_sql_handlers)
        has_cancel = "cancel()" in source
        assert has_cancel, "接続キャンセル処理 cancel() が未実装"

    def test_dbapi_connection_access(self):
        """DBAPI レベルの接続アクセスが実装されている"""
        source = inspect.getsource(_sql_handlers)
        has_dbapi = "dbapi_connection" in source or "raw_connection" in source or "connection().connection" in source
        assert has_dbapi, "DBAPI 接続レベルのアクセスが未実装"


class TestShutdownEngines:
    """shutdown_engines が全キャッシュエンジンを dispose すること"""

    def test_shutdown_engines_exists(self):
        """shutdown_engines 関数が存在する"""
        assert _shutdown_engines is not None, "shutdown_engines が sql_handlers に定義されていない"

    def test_shutdown_engines_disposes_all(self):
        """shutdown_engines が全エンジンの dispose を呼ぶ"""
        if _shutdown_engines is None:
            pytest.fail("shutdown_engines が未実装")
        if _get_engine is None:
            pytest.fail("_get_engine が未実装")

        engine1 = _get_engine("postgresql://localhost/test_sd_1")
        engine2 = _get_engine("postgresql://localhost/test_sd_2")

        _shutdown_engines()

        engine1.dispose.assert_called()
        engine2.dispose.assert_called()
