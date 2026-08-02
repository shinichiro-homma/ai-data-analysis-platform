"""カーネル cwd からのワークスペース解決（I3: async でブロッキング I/O をしない）のユニットテスト

タスク 11.2「ruff ASYNC ルールの有効化」の Red フェーズ。

- `_resolve_workspace_id_from_cwd_sync()`: `resolve_workspace_for_kernel` のブロック 3 から
  切り出す同期ヘルパー（正常系・異常系・境界値）
- `resolve_workspace_for_kernel`: 上記ヘルパーを `run_in_executor` でオフロードしていること、
  および executor 越しの `ValueError` が既存の `except Exception` に届くこと
- ruff ASYNC ゲート自体の回帰テスト（stdin モードで実行しソースツリーを汚さない）

cell_handlers.py は Tornado/Jupyter の重い依存を持つため、モジュールロードのパターンは
test_cell_execute_batch.py:19-130 を模倣する（`custom_api.session_handlers` のモックが必須。
`resolve_workspace_for_kernel` が関数内で `from .session_handlers import get_kernel_workspace`
を行うため、未登録だと実物がロードされ ImportError になる）。
"""

import asyncio
import importlib.util
import inspect
import subprocess
import sys
import types as _types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"
_repo_root = Path(__file__).resolve().parent.parent.parent

# --- 1. 重い依存のモック ---
for _mod_name in ("pandas", "sqlalchemy", "sqlalchemy.exc", "tornado", "tornado.web"):
    if _mod_name not in sys.modules:
        _m = _types.ModuleType(_mod_name)
        if _mod_name == "tornado.web":
            _m.authenticated = lambda f: f
        sys.modules[_mod_name] = _m

# --- 2. custom_api パッケージ構造の構築 ---
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# base モジュールのモック
if "custom_api.base" not in sys.modules:
    _base_mock = _types.ModuleType("custom_api.base")
    _base_mock.__package__ = "custom_api"
    _base_mock.BaseCustomHandler = type("BaseCustomHandler", (), {})
    _base_mock.resolve_workspace_dir = lambda *a, **kw: None
    _base_mock.validate_timeout = lambda *a, **kw: (30, None)
    _base_mock.validate_workspace_id = lambda *a, **kw: None
    _base_mock.workspace_contents_path = lambda ws_id: f"workspaces/sample/{ws_id}"
    _base_mock.utc_now_iso = lambda: "2026-01-01T00:00:00Z"
    _base_mock.WORKSPACE_ROOT_DIR = "/home/jovyan/work/workspaces/sample"
    _base_mock.WORKSPACE_PATH_PREFIX = "workspaces/sample"
    _base_mock.JUPYTER_ROOT_DIR = "/home/jovyan/work"
    _base_mock.validate_kernel_name = lambda *a, **kw: None
    _base_mock._apply_lock_token = lambda handler: None
    _base_mock._build_timeout_error_result = lambda *a, **kw: {}

    def _real_validate_path(user_input, base_dir="/home/jovyan/work"):
        if not user_input:
            return ""
        clean_path = user_input.lstrip("/")
        base = Path(base_dir).resolve()
        target = (base / clean_path).resolve()
        try:
            target.relative_to(base)
        except ValueError:
            raise ValueError(f"不正なパスです: {user_input}") from None
        return clean_path

    _base_mock.validate_path = _real_validate_path
    sys.modules["custom_api.base"] = _base_mock

# ai_events モジュールのモック
if "custom_api.ai_events" not in sys.modules:
    _ai_events_mock = _types.ModuleType("custom_api.ai_events")
    _ai_events_mock.__package__ = "custom_api"
    _ai_events_mock.AiEventsWebSocketHandler = type("AiEventsWebSocketHandler", (), {})
    _ai_events_mock.AiEventsPostHandler = type("AiEventsPostHandler", (), {})
    sys.modules["custom_api.ai_events"] = _ai_events_mock

# code_validator モジュール（実際にロード — 純粋関数のため）
if "custom_api.code_validator" not in sys.modules:
    _cv_path = _ext_dir / "custom_api" / "code_validator.py"
    _cv_spec = importlib.util.spec_from_file_location(
        "custom_api.code_validator", _cv_path, submodule_search_locations=[]
    )
    _cv_mod = importlib.util.module_from_spec(_cv_spec)
    _cv_mod.__package__ = "custom_api"
    sys.modules["custom_api.code_validator"] = _cv_mod
    _cv_spec.loader.exec_module(_cv_mod)

# kernel_executor モジュールのモック
if "custom_api.kernel_executor" not in sys.modules:
    _ke_mock = _types.ModuleType("custom_api.kernel_executor")
    _ke_mock.__package__ = "custom_api"
    _ke_mock.KernelExecutor = MagicMock
    sys.modules["custom_api.kernel_executor"] = _ke_mock

# session_handlers モジュールのモック（resolve_workspace_for_kernel の関数内 import に必須）
if "custom_api.session_handlers" not in sys.modules:
    _sh_mock = _types.ModuleType("custom_api.session_handlers")
    _sh_mock.__package__ = "custom_api"
    _sh_mock.CustomSessionsHandler = type("CustomSessionsHandler", (), {})
    _sh_mock.get_kernel_workspace = lambda *a: None
    _sh_mock.unregister_kernel = lambda *a: None
    sys.modules["custom_api.session_handlers"] = _sh_mock

# sql_handlers モジュールのモック
if "custom_api.sql_handlers" not in sys.modules:
    _sql_mock = _types.ModuleType("custom_api.sql_handlers")
    _sql_mock.__package__ = "custom_api"
    _sql_mock.SqlExecuteHandler = type("SqlExecuteHandler", (), {})
    _sql_mock.SqlExportHandler = type("SqlExportHandler", (), {})
    _sql_mock.shutdown_engines = lambda: None
    sys.modules["custom_api.sql_handlers"] = _sql_mock

# workspace_handlers モジュールのモック
if "custom_api.workspace_handlers" not in sys.modules:
    _wh_mock = _types.ModuleType("custom_api.workspace_handlers")
    _wh_mock.__package__ = "custom_api"
    _wh_mock.WorkspaceHandler = type("WorkspaceHandler", (), {})
    _wh_mock.WorkspacesHandler = type("WorkspacesHandler", (), {})
    _wh_mock.WorkspaceSummarizeHandler = type("WorkspaceSummarizeHandler", (), {})
    sys.modules["custom_api.workspace_handlers"] = _wh_mock

# --- 3. cell_handlers モジュールをロード ---
if "custom_api.cell_handlers" not in sys.modules:
    _cell_module_path = _ext_dir / "custom_api" / "cell_handlers.py"
    _cell_handlers_spec = importlib.util.spec_from_file_location(
        "custom_api.cell_handlers",
        _cell_module_path,
        submodule_search_locations=[],
    )
    _cell_handlers = importlib.util.module_from_spec(_cell_handlers_spec)
    _cell_handlers.__package__ = "custom_api"
    sys.modules["custom_api.cell_handlers"] = _cell_handlers
    _cell_handlers_spec.loader.exec_module(_cell_handlers)
else:
    _cell_handlers = sys.modules["custom_api.cell_handlers"]

# cell_handlers がロード時に取り込んだ WORKSPACE_ROOT_DIR（モック値）を正とする
WORKSPACE_ROOT = _cell_handlers.WORKSPACE_ROOT_DIR

# ワークスペースルート外の cwd（macOS では /private/etc に解決されるがルート外である点は変わらない）
OUTSIDE_ROOT_CWD = "/etc"


def _make_handler(cwd: str | None) -> MagicMock:
    """resolve_workspace_for_kernel に渡すハンドラのモックを組み立てる。

    - session_manager なし（ブロック 1 をスキップ）
    - get_kernel_workspace は None を返す（session_handlers モック。ブロック 2 をスキップ）
    - kernel_manager.get_kernel() が指定 cwd を持つカーネルを返す（ブロック 3 に到達）
    """
    handler = MagicMock()
    handler.settings = {}
    handler.kernel_manager.get_kernel.return_value = SimpleNamespace(cwd=cwd)
    return handler


class TestResolveWorkspaceIdFromCwdSync:
    """同期ヘルパー _resolve_workspace_id_from_cwd_sync の単体テスト"""

    def test_returns_workspace_id_for_cwd_under_root(self):
        """正常系: ワークスペースルート配下の cwd から workspace_id を返す"""
        cwd = f"{WORKSPACE_ROOT}/ws-a/sub"

        result = _cell_handlers._resolve_workspace_id_from_cwd_sync(cwd)

        assert result == "ws-a"

    def test_raises_value_error_for_cwd_outside_root(self):
        """異常系: ワークスペースルート外の cwd では ValueError を送出する"""
        with pytest.raises(ValueError):
            _cell_handlers._resolve_workspace_id_from_cwd_sync(OUTSIDE_ROOT_CWD)

    def test_returns_none_when_cwd_is_root_itself(self):
        """境界値: cwd がルート自身のとき rel.parts が空になり None を返す"""
        result = _cell_handlers._resolve_workspace_id_from_cwd_sync(WORKSPACE_ROOT)

        assert result is None


class TestResolveWorkspaceForKernelOffload:
    """resolve_workspace_for_kernel が run_in_executor でオフロードしていることの検証"""

    @pytest.mark.asyncio
    async def test_offloads_via_run_in_executor(self, monkeypatch, tmp_path):
        """同期ヘルパーが loop.run_in_executor 経由で呼ばれる（直接呼び出しの実装ミスを検知）"""
        # resolve_workspace_for_kernel が coroutine function（async def）のままであること
        assert inspect.iscoroutinefunction(_cell_handlers.resolve_workspace_for_kernel)

        # Arrange: 実行中の loop インスタンスの run_in_executor だけを spy する
        # （asyncio.get_running_loop のグローバル patch は他テストに波及するため使わない）
        loop = asyncio.get_running_loop()
        original_run_in_executor = loop.run_in_executor
        calls = []

        def _spy(executor, func, *args):
            calls.append((func, args))
            return original_run_in_executor(executor, func, *args)

        monkeypatch.setattr(loop, "run_in_executor", _spy)
        monkeypatch.setattr(_cell_handlers, "resolve_workspace_dir", lambda ws_id: tmp_path / ws_id)

        handler = _make_handler(cwd=f"{WORKSPACE_ROOT}/ws-a/sub")

        # Act
        output_dir, workspace_rel_path = await _cell_handlers.resolve_workspace_for_kernel(handler, "k1")

        # Assert
        offloaded = [func for func, _ in calls if func is _cell_handlers._resolve_workspace_id_from_cwd_sync]
        assert offloaded, f"_resolve_workspace_id_from_cwd_sync が run_in_executor 経由で呼ばれていない: {calls}"
        assert calls[0][1] == (f"{WORKSPACE_ROOT}/ws-a/sub",)
        assert output_dir == tmp_path / "ws-a" / "output"
        assert workspace_rel_path == "workspaces/sample/ws-a"


class TestResolveWorkspaceForKernelErrorHandling:
    """executor 越しの例外が既存の except Exception に届くことの検証（end-to-end 異常系）"""

    @pytest.mark.asyncio
    async def test_resolve_returns_none_tuple_for_cwd_outside_root(self):
        """異常系: ワークスペース外の cwd では (None, None) を返す（例外を握りつぶさない）"""
        handler = _make_handler(cwd=OUTSIDE_ROOT_CWD)

        result = await _cell_handlers.resolve_workspace_for_kernel(handler, "k1")

        assert result == (None, None)


# async def 内でブロッキング I/O（Path.resolve）を行うプローブ。ruff の stdin に流す
_RUFF_PROBE_SNIPPET = "from pathlib import Path\n\n\nasync def f(p: str) -> None:\n    Path(p).resolve()\n"


class TestRuffAsyncGate:
    """ruff ASYNC ゲート自体の回帰テスト（ソースツリーにプローブファイルを作らない）"""

    def test_ruff_async_gate_detects_blocking_io(self):
        """異常系: async 関数内のブロッキング I/O に対し ruff が exit 1 と ASYNC240 を返す"""
        command = [
            "uv",
            "run",
            "ruff",
            "check",
            "--stdin-filename",
            "jupyter-server/extensions/custom_api/_probe.py",
            "--output-format",
            "concise",
            "-",
        ]
        try:
            result = subprocess.run(
                command,
                input=_RUFF_PROBE_SNIPPET,
                capture_output=True,
                text=True,
                cwd=str(_repo_root),
                check=False,
            )
        except FileNotFoundError:
            pytest.skip("uv / ruff が未インストールのため skip")

        # returncode が 0（違反なし）や 2 以上（ruff の実行エラー）の場合は skip せず fail させる
        assert result.returncode == 1, (
            f"ruff の returncode が 1 ではない: {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
        assert "ASYNC240" in result.stdout, f"ASYNC240 が報告されていない\nstdout:\n{result.stdout}"
