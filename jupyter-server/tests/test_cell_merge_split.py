"""ContentsCellsHandler の merge/split アクションのユニットテスト

handlers.py の ContentsCellsHandler.patch() に merge/split アクションを追加する。
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

validate_path = _handlers.validate_path
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
# merge 正常系テスト
# ============================================================


class TestMergeNormal:
    """merge アクションの正常系テスト"""

    @pytest.mark.asyncio
    async def test_merge_two_code_cells(self):
        """2つのコードセルを結合: ソースが \\n 区切りで連結される"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "code", "source": "b = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 1})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        # save が呼ばれたことを確認
        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        merged_cells = saved_model["content"]["cells"]
        assert len(merged_cells) == 1
        assert merged_cells[0]["source"] == "a = 1\nb = 2"
        assert merged_cells[0]["cell_type"] == "code"

    @pytest.mark.asyncio
    async def test_merge_three_code_cells(self):
        """3つ以上のコードセルを結合"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "code", "source": "b = 2", "outputs": [], "execution_count": None},
            {"cell_type": "code", "source": "c = 3", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 2})

        assert handler._responses[0][0] == "success"
        saved_model = handler.contents_manager.save.call_args[0][0]
        merged_cells = saved_model["content"]["cells"]
        assert len(merged_cells) == 1
        assert merged_cells[0]["source"] == "a = 1\nb = 2\nc = 3"

    @pytest.mark.asyncio
    async def test_merge_two_markdown_cells(self):
        """2つの Markdown セルを結合"""
        cells = [
            {"cell_type": "markdown", "source": "# Title"},
            {"cell_type": "markdown", "source": "Some text"},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 1})

        assert handler._responses[0][0] == "success"
        saved_model = handler.contents_manager.save.call_args[0][0]
        merged_cells = saved_model["content"]["cells"]
        assert len(merged_cells) == 1
        assert merged_cells[0]["source"] == "# Title\nSome text"
        assert merged_cells[0]["cell_type"] == "markdown"


# ============================================================
# merge 異常系テスト
# ============================================================


class TestMergeError:
    """merge アクションの異常系テスト"""

    @pytest.mark.asyncio
    async def test_merge_start_greater_than_end(self):
        """start_index > end_index でエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "code", "source": "b = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 1, "end_index": 0})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_merge_out_of_range(self):
        """end_index が範囲外でエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "code", "source": "b = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 5})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_merge_single_cell(self):
        """start_index == end_index（セル数1）で結合不可エラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 0})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_merge_mixed_cell_types(self):
        """セルタイプが混在している場合にエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "markdown", "source": "# Title"},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "merge", "start_index": 0, "end_index": 1})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"


# ============================================================
# split 正常系テスト
# ============================================================


class TestSplitNormal:
    """split アクションの正常系テスト"""

    @pytest.mark.asyncio
    async def test_split_at_middle_line(self):
        """セルを中間行で分割"""
        cells = [
            {"cell_type": "code", "source": "a = 1\nb = 2\nc = 3", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "split", "index": 0, "split_line": 1})

        assert handler._responses[0][0] == "success"
        saved_model = handler.contents_manager.save.call_args[0][0]
        split_cells = saved_model["content"]["cells"]
        assert len(split_cells) == 2
        assert split_cells[0]["source"] == "a = 1"
        assert split_cells[1]["source"] == "b = 2\nc = 3"
        assert split_cells[0]["cell_type"] == "code"
        assert split_cells[1]["cell_type"] == "code"

    @pytest.mark.asyncio
    async def test_split_at_first_line(self):
        """先頭行（split_line=0）で分割: 前半が空"""
        cells = [
            {"cell_type": "code", "source": "a = 1\nb = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        # split_line=0 は「0行目の後で分割」ではなく「0行目の前で分割」
        # つまり前半が空、後半が全行
        # → 実装仕様に合わせる: split_line は「前半に含む行数」とする
        # split_line=1 なら前半は1行目まで、split_line=0 は無効
        # 仕様: split_line は分割位置（この行の前で分割）
        # split_line=1 → 0行目が前半、1行目以降が後半
        await _call_patch(handler, path, {"action": "split", "index": 0, "split_line": 1})

        assert handler._responses[0][0] == "success"
        saved_model = handler.contents_manager.save.call_args[0][0]
        split_cells = saved_model["content"]["cells"]
        assert len(split_cells) == 2
        assert split_cells[0]["source"] == "a = 1"
        assert split_cells[1]["source"] == "b = 2"

    @pytest.mark.asyncio
    async def test_split_at_last_line_minus_one(self):
        """最終行の1つ前で分割"""
        cells = [
            {"cell_type": "markdown", "source": "# Title\nParagraph 1\nParagraph 2"},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "split", "index": 0, "split_line": 2})

        assert handler._responses[0][0] == "success"
        saved_model = handler.contents_manager.save.call_args[0][0]
        split_cells = saved_model["content"]["cells"]
        assert len(split_cells) == 2
        assert split_cells[0]["source"] == "# Title\nParagraph 1"
        assert split_cells[1]["source"] == "Paragraph 2"
        assert split_cells[0]["cell_type"] == "markdown"
        assert split_cells[1]["cell_type"] == "markdown"


# ============================================================
# split 異常系テスト
# ============================================================


class TestSplitError:
    """split アクションの異常系テスト"""

    @pytest.mark.asyncio
    async def test_split_out_of_range_index(self):
        """範囲外のセルインデックスでエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1\nb = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "split", "index": 5, "split_line": 1})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_split_out_of_range_split_line(self):
        """範囲外の split_line でエラー（行数以上の値）"""
        cells = [
            {"cell_type": "code", "source": "a = 1\nb = 2", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        # ソースは2行なので split_line は 1 まで有効（split_line=2 は最終行の後 → 後半が空）
        # split_line >= 行数はエラーとする
        await _call_patch(handler, path, {"action": "split", "index": 0, "split_line": 10})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"
