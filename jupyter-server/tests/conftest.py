"""
pytest conftest.py — テストセッション全体の共有フィクスチャ

custom_api.__init__ を tests/test_kernel_crash_recovery.py から
`from custom_api import __init__ as init_module` でアクセスできるよう、
セッション開始時に custom_api パッケージの __init__ 属性を設定する。
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


def _load_init_module():
    """custom_api/__init__.py を custom_api.__init__ サブモジュールとしてロードし、
    custom_api パッケージの __init__ 属性に設定する。

    custom_api/__init__.py は handlers.py 等の重い依存を持つため、
    ロードには事前に sys.modules への必要なモック登録が必要。
    """
    if "custom_api.__init__" in sys.modules:
        return sys.modules["custom_api.__init__"]

    # custom_api パッケージが bare module として登録済みであることを前提とする
    pkg = sys.modules.get("custom_api")
    if pkg is None:
        return None

    # __init__.py が依存する外部モジュールのモック（未登録分のみ）
    def _ensure(name, **attrs):
        if name not in sys.modules:
            mod = types.ModuleType(name)
            for k, v in attrs.items():
                setattr(mod, k, v)
            sys.modules[name] = mod
        return sys.modules[name]

    _ensure("jupyter_server")
    _ensure("jupyter_server.base")
    _ensure(
        "jupyter_server.base.handlers",
        APIHandler=type("APIHandler", (), {}),
        JupyterHandler=type("JupyterHandler", (), {}),
    )
    _ensure("tornado")
    _ensure("tornado.web", authenticated=lambda f: f)
    _ensure("sqlalchemy")
    _ensure("sqlalchemy.exc", OperationalError=Exception, ProgrammingError=Exception)
    _ensure("pandas")

    # custom_api サブモジュールのモック（handlers.py 依存分）
    def _ensure_ca(name, **attrs):
        return _ensure(f"custom_api.{name}", __package__="custom_api", **attrs)

    _ensure_ca(
        "ai_events",
        AiEventsPostHandler=type("AiEventsPostHandler", (), {}),
        AiEventsWebSocketHandler=type("AiEventsWebSocketHandler", (), {}),
    )
    _ensure_ca("code_validator", validate_code=lambda *a, **kw: None)
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

    # handlers モジュールのモック（get_handlers だけ提供）
    _ensure_ca("handlers", get_handlers=lambda *a, **kw: [])

    # __init__.py をロード
    init_path = _ext_dir / "custom_api" / "__init__.py"
    spec = importlib.util.spec_from_file_location("custom_api.__init__", init_path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules["custom_api.__init__"] = mod
    spec.loader.exec_module(mod)

    # custom_api パッケージの __init__ 属性に設定する
    # これにより `from custom_api import __init__ as x` が mod を返すようになる
    pkg.__init__ = mod

    return mod


@pytest.fixture(scope="session", autouse=True)
def setup_custom_api_init():
    """custom_api.__init__ をセッション開始時にセットアップする"""
    _load_init_module()
