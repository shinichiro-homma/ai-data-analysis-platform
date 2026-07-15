"""ContentsCellsHandler の change_type/copy アクションのユニットテスト

cell_handlers.py の ContentsCellsHandler.patch() に change_type/copy アクションを追加する。
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
    _base_mock.validate_path = lambda path, *a, **kw: path
    _base_mock._apply_lock_token = lambda handler: None
    sys.modules["custom_api.base"] = _base_mock

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

# --- 3. cell_handlers モジュールをロード ---
_module_path = _ext_dir / "custom_api" / "cell_handlers.py"
_cell_handlers_spec = importlib.util.spec_from_file_location(
    "custom_api.cell_handlers",
    _module_path,
    submodule_search_locations=[],
)
_cell_handlers = importlib.util.module_from_spec(_cell_handlers_spec)
_cell_handlers.__package__ = "custom_api"
sys.modules["custom_api.cell_handlers"] = _cell_handlers
_cell_handlers_spec.loader.exec_module(_cell_handlers)

ContentsCellsHandler = _cell_handlers.ContentsCellsHandler


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
# change_type 正常系テスト
# ============================================================


class TestChangeTypeNormal:
    """change_type アクションの正常系テスト"""

    @pytest.mark.asyncio
    async def test_change_type_code_to_markdown(self):
        """code → markdown 変換: outputs と execution_count がクリアされる"""
        cells = [
            {
                "cell_type": "code",
                "source": "print('hello')",
                "outputs": [{"output_type": "stream", "text": "hello\n"}],
                "execution_count": 5,
            },
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "change_type", "index": 0, "cell_type": "markdown"})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        changed_cells = saved_model["content"]["cells"]
        assert len(changed_cells) == 1
        assert changed_cells[0]["cell_type"] == "markdown"
        assert changed_cells[0]["source"] == "print('hello')"
        assert changed_cells[0]["outputs"] == []
        assert changed_cells[0]["execution_count"] is None

    @pytest.mark.asyncio
    async def test_change_type_markdown_to_code(self):
        """markdown → code 変換: outputs と execution_count が初期化される"""
        cells = [
            {
                "cell_type": "markdown",
                "source": "# Title",
            },
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "change_type", "index": 0, "cell_type": "code"})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        changed_cells = saved_model["content"]["cells"]
        assert len(changed_cells) == 1
        assert changed_cells[0]["cell_type"] == "code"
        assert changed_cells[0]["source"] == "# Title"
        assert changed_cells[0]["outputs"] == []
        assert changed_cells[0]["execution_count"] is None


# ============================================================
# change_type 異常系テスト
# ============================================================


class TestChangeTypeError:
    """change_type アクションの異常系テスト"""

    @pytest.mark.asyncio
    async def test_change_type_out_of_range_index(self):
        """範囲外のインデックスでエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "change_type", "index": 5, "cell_type": "markdown"})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_change_type_invalid_cell_type(self):
        """無効な cell_type 値でエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "change_type", "index": 0, "cell_type": "raw"})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"


# ============================================================
# copy 正常系テスト
# ============================================================


class TestCopyNormal:
    """copy アクションの正常系テスト"""

    @pytest.mark.asyncio
    async def test_copy_cell_to_specified_position(self):
        """セルを指定位置にコピー"""
        cells = [
            {
                "cell_type": "code",
                "source": "a = 1",
                "outputs": [{"output_type": "stream", "text": "1\n"}],
                "execution_count": 3,
            },
            {"cell_type": "code", "source": "b = 2", "outputs": [], "execution_count": None},
            {"cell_type": "markdown", "source": "# End"},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "copy", "index": 0, "to_index": 2})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        result_cells = saved_model["content"]["cells"]
        assert len(result_cells) == 4
        # コピーされたセルは to_index=2 の位置に挿入される
        assert result_cells[2]["cell_type"] == "code"
        assert result_cells[2]["source"] == "a = 1"
        # コードセルのコピーは outputs と execution_count がリセットされる
        assert result_cells[2]["outputs"] == []
        assert result_cells[2]["execution_count"] is None
        # 元のセルは変更されない
        assert result_cells[0]["source"] == "a = 1"
        assert result_cells[0]["execution_count"] == 3

    @pytest.mark.asyncio
    async def test_copy_cell_without_to_index(self):
        """to_index 省略時はソースの直後に挿入"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
            {"cell_type": "markdown", "source": "# End"},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "copy", "index": 0})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "success"

        handler.contents_manager.save.assert_called_once()
        saved_model = handler.contents_manager.save.call_args[0][0]
        result_cells = saved_model["content"]["cells"]
        assert len(result_cells) == 3
        # index=0 の直後 (位置1) にコピーされる
        assert result_cells[1]["cell_type"] == "code"
        assert result_cells[1]["source"] == "a = 1"


# ============================================================
# copy 異常系テスト
# ============================================================


class TestCopyError:
    """copy アクションの異常系テスト"""

    @pytest.mark.asyncio
    async def test_copy_out_of_range_index(self):
        """範囲外の index でエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "copy", "index": 5})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"

    @pytest.mark.asyncio
    async def test_copy_out_of_range_to_index(self):
        """範囲外の to_index でエラー"""
        cells = [
            {"cell_type": "code", "source": "a = 1", "outputs": [], "execution_count": None},
        ]
        handler, path = _make_handler(cells)
        await _call_patch(handler, path, {"action": "copy", "index": 0, "to_index": 100})

        assert len(handler._responses) == 1
        assert handler._responses[0][0] == "error"
