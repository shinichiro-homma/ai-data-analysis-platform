"""ContentsCellsHandler の clear_output アクションと
ContentsCellsClearAllOutputsHandler のユニットテスト

handlers.py の ContentsCellsHandler.patch() に clear_output アクションを追加し、
ContentsCellsClearAllOutputsHandler.post() で全セル出力クリアを行う。
ハンドラーの処理ロジックを直接インポートしてモックでテストする。

テスト対象のアクションがまだ存在しないため（TDD Red フェーズ）、
ハンドラーの存在確認とアクション実行結果のテストを行う。
"""

import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"

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
    _base_mock.workspace_contents_path = lambda *a, **kw: ""
    _base_mock.utc_now_iso = lambda: "2026-01-01T00:00:00Z"
    _base_mock.WORKSPACE_ROOT_DIR = "/home/jovyan/work/workspaces/sample"
    _base_mock.WORKSPACE_PATH_PREFIX = "workspaces/sample"
    _base_mock.JUPYTER_ROOT_DIR = "/home/jovyan/work"
    _base_mock.validate_kernel_name = lambda *a, **kw: None
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

# session_handlers モジュールのモック
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
    sys.modules["custom_api.sql_handlers"] = _sql_mock

# workspace_handlers モジュールのモック
if "custom_api.workspace_handlers" not in sys.modules:
    _wh_mock = _types.ModuleType("custom_api.workspace_handlers")
    _wh_mock.__package__ = "custom_api"
    _wh_mock.WorkspaceHandler = type("WorkspaceHandler", (), {})
    _wh_mock.WorkspacesHandler = type("WorkspacesHandler", (), {})
    _wh_mock.WorkspaceSummarizeHandler = type("WorkspaceSummarizeHandler", (), {})
    sys.modules["custom_api.workspace_handlers"] = _wh_mock

# --- 3. handlers モジュールをロード ---
_module_path = _ext_dir / "custom_api" / "handlers.py"
_handlers_spec = importlib.util.spec_from_file_location(
    "custom_api.handlers",
    _module_path,
    submodule_search_locations=[],
)
_handlers = importlib.util.module_from_spec(_handlers_spec)
_handlers.__package__ = "custom_api"
sys.modules["custom_api.handlers"] = _handlers
_handlers_spec.loader.exec_module(_handlers)

ContentsCellsHandler = _handlers.ContentsCellsHandler


# ============================================================
# ヘルパー: ContentsCellsHandler のモックインスタンスを作成
# ============================================================


def _make_handler(cells: list[dict], path: str = "workspaces/sample/ws-001/test.ipynb"):
    """ContentsCellsHandler のモックを作成し、patch() を呼べるようにする"""
    handler = MagicMock(spec=ContentsCellsHandler)

    model = {
        "type": "notebook",
        "content": {"cells": [dict(c) for c in cells]},
    }

    handler.get_json_body = MagicMock()
    handler.contents_manager = MagicMock()
    handler.contents_manager.get = AsyncMock(return_value=model)
    handler.contents_manager.save = AsyncMock()

    _responses = []
    handler.write_success = MagicMock(side_effect=lambda d: _responses.append(("success", d)))
    handler.write_error_response = MagicMock(
        side_effect=lambda code, msg, status: _responses.append(("error", code, msg, status))
    )
    handler._responses = _responses
    handler._model = model

    return handler, path


async def _call_patch(handler, path, body):
    """handler.patch() をバインドして呼び出す"""
    handler.get_json_body.return_value = body
    await ContentsCellsHandler.patch(handler, path)


# ============================================================
# ヘルパー: ContentsCellsClearAllOutputsHandler のモックインスタンス
# ============================================================


def _make_clear_all_handler(cells: list[dict], path: str = "workspaces/sample/ws-001/test.ipynb"):
    """ContentsCellsClearAllOutputsHandler のモックを作成し、post() を呼べるようにする"""
    ContentsCellsClearAllOutputsHandler = _handlers.ContentsCellsClearAllOutputsHandler
    handler = MagicMock(spec=ContentsCellsClearAllOutputsHandler)

    model = {
        "type": "notebook",
        "content": {"cells": [dict(c) for c in cells]},
    }

    handler.contents_manager = MagicMock()
    handler.contents_manager.get = AsyncMock(return_value=model)
    handler.contents_manager.save = AsyncMock()

    _responses = []
    handler.write_success = MagicMock(side_effect=lambda d: _responses.append(("success", d)))
    handler.write_error_response = MagicMock(
        side_effect=lambda code, msg, status: _responses.append(("error", code, msg, status))
    )
    handler._responses = _responses
    handler._model = model
    handler._cls = ContentsCellsClearAllOutputsHandler

    return handler, path


async def _call_clear_all_post(handler, path):
    """handler.post() をバインドして呼び出す"""
    await handler._cls.post(handler, path)


# ============================================================
# clear_output 正常系テスト
# ============================================================


class TestClearOutputNormal:
    """clear_output アクションの正常系テスト"""

    @pytest.mark.asyncio
    async def test_clear_output_code_cell(self):
        """コードセルの出力クリア: outputs が [] に、execution_count が null になる"""
        cells = [
            {
                "cell_type": "code",
                "source": "print('hello')",
                "outputs": [{"output_type": "stream", "text": "hello\n"}],
                "execution_count": 5,
            },
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "clear_output", "index": 0})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        changed_cells = saved_model["content"]["cells"]
        assert len(changed_cells) == 1
        assert changed_cells[0]["outputs"] == []
        assert changed_cells[0]["execution_count"] is None
        # source は変更されない
        assert changed_cells[0]["source"] == "print('hello')"
        assert changed_cells[0]["cell_type"] == "code"

    @pytest.mark.asyncio
    async def test_clear_output_markdown_cell(self):
        """マークダウンセルに対しても正常に動作する（エラーにならない）"""
        cells = [
            {
                "cell_type": "markdown",
                "source": "# Title",
            },
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "clear_output", "index": 0})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"


# ============================================================
# clear_output 異常系テスト
# ============================================================


class TestClearOutputError:
    """clear_output アクションの異常系テスト"""

    @pytest.mark.asyncio
    async def test_clear_output_out_of_range_index(self):
        """範囲外のインデックスでエラー"""
        cells = [
            {
                "cell_type": "code",
                "source": "a = 1",
                "outputs": [],
                "execution_count": None,
            },
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "clear_output", "index": 5})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"


# ============================================================
# clear-all-outputs 正常系テスト
# ============================================================


class TestClearAllOutputsNormal:
    """clear-all-outputs エンドポイントの正常系テスト"""

    @pytest.mark.asyncio
    async def test_clear_all_outputs_code_cells(self):
        """全コードセルの outputs が [] に、execution_count が null になる"""
        cells = [
            {
                "cell_type": "code",
                "source": "print('hello')",
                "outputs": [{"output_type": "stream", "text": "hello\n"}],
                "execution_count": 1,
            },
            {
                "cell_type": "code",
                "source": "print('world')",
                "outputs": [{"output_type": "stream", "text": "world\n"}],
                "execution_count": 2,
            },
        ]
        handler, path = _make_clear_all_handler(cells)
        await _call_clear_all_post(handler, path)

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        changed_cells = saved_model["content"]["cells"]
        assert len(changed_cells) == 2
        for cell in changed_cells:
            assert cell["outputs"] == []
            assert cell["execution_count"] is None

    @pytest.mark.asyncio
    async def test_clear_all_outputs_skips_markdown_cells(self):
        """マークダウンセルはスキップされ、コードセルのみクリアされる"""
        cells = [
            {
                "cell_type": "code",
                "source": "x = 1",
                "outputs": [{"output_type": "stream", "text": "1\n"}],
                "execution_count": 1,
            },
            {
                "cell_type": "markdown",
                "source": "# Title",
            },
            {
                "cell_type": "code",
                "source": "y = 2",
                "outputs": [{"output_type": "stream", "text": "2\n"}],
                "execution_count": 2,
            },
        ]
        handler, path = _make_clear_all_handler(cells)
        await _call_clear_all_post(handler, path)

        assert len(handler._responses) == 1
        resp = handler._responses[0]
        assert resp[0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        changed_cells = saved_model["content"]["cells"]
        # コードセルの出力がクリアされている
        assert changed_cells[0]["outputs"] == []
        assert changed_cells[0]["execution_count"] is None
        assert changed_cells[2]["outputs"] == []
        assert changed_cells[2]["execution_count"] is None
        # マークダウンセルは変更されない
        assert changed_cells[1]["cell_type"] == "markdown"
        assert changed_cells[1]["source"] == "# Title"

    @pytest.mark.asyncio
    async def test_clear_all_outputs_empty_notebook(self):
        """セルがない場合も正常終了する（cleared_cells: 0）"""
        cells = []
        handler, path = _make_clear_all_handler(cells)
        await _call_clear_all_post(handler, path)

        assert len(handler._responses) == 1
        resp = handler._responses[0]
        assert resp[0] == "success"
        # レスポンスデータに cleared_cells: 0 が含まれること
        success_data = resp[1]
        assert success_data["cleared_cells"] == 0
