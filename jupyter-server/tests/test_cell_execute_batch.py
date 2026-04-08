"""ContentsCellExecuteBatchHandler のユニットテスト

handlers.py の ContentsCellExecuteBatchHandler は Tornado/Jupyter の重い依存を持つため、
ハンドラーの処理ロジックを直接インポートしてモックでテストする。

テスト対象のハンドラがまだ存在しないため（TDD Red フェーズ）、
ハンドラの存在確認と純粋関数部分のテストを行う。
"""

import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

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

get_handlers = _handlers.get_handlers
validate_path = _handlers.validate_path


# ============================================================
# ハンドラー存在確認テスト
# ============================================================


class TestContentsCellExecuteBatchHandlerExists:
    """ContentsCellExecuteBatchHandler がハンドラーモジュールに存在することを確認する"""

    def test_handler_class_exists(self):
        """ContentsCellExecuteBatchHandler クラスが handlers.py に定義されている"""
        assert hasattr(_handlers, "ContentsCellExecuteBatchHandler"), (
            "ContentsCellExecuteBatchHandler が handlers.py に定義されていません"
        )

    def test_handler_registered_in_get_handlers(self):
        """execute-batch ルートが get_handlers() に登録されている"""
        handlers = get_handlers("")
        paths = [h[0] for h in handlers]
        batch_routes = [p for p in paths if "execute-batch" in p]
        assert len(batch_routes) > 0, "execute-batch ルートが get_handlers() に登録されていません"

    def test_execute_batch_route_before_cells_route(self):
        """execute-batch ルートが /cells ルートよりも前に登録されている（Tornado の先頭一致対策）"""
        handlers = get_handlers("")
        paths = [h[0] for h in handlers]

        batch_idx = None
        cells_idx = None
        for i, p in enumerate(paths):
            if "execute-batch" in p and batch_idx is None:
                batch_idx = i
            if p.endswith("/cells") and cells_idx is None:
                cells_idx = i

        assert batch_idx is not None, "execute-batch ルートが見つかりません"
        assert cells_idx is not None, "/cells ルートが見つかりません"
        assert batch_idx < cells_idx, (
            f"execute-batch ({batch_idx}) は /cells ({cells_idx}) よりも前に登録されるべきです"
        )


# ============================================================
# validate_path テスト（純粋関数、ハンドラー共通のパス検証）
# ============================================================


class TestValidatePathForBatch:
    """execute-batch で使用するパス検証が正しく動作することを確認する"""

    def test_valid_notebook_path(self):
        """正常なノートブックパスが検証を通過する"""
        result = validate_path("workspaces/sample/ws-001/analysis.ipynb")
        assert result == "workspaces/sample/ws-001/analysis.ipynb"

    def test_path_traversal_rejected(self):
        """パストラバーサル攻撃が拒否される"""
        with pytest.raises(ValueError):
            validate_path("../../../etc/passwd")

    def test_dot_dot_escaping_base_dir_rejected(self):
        """パスに .. を使ってベースディレクトリ外に出ようとする場合は拒否される"""
        with pytest.raises(ValueError):
            validate_path("../../etc/passwd")


# ============================================================
# 正常系テスト
# ============================================================


class TestBatchExecuteAllMode:
    """mode: all で全コードセルが実行される"""

    def test_mode_all_executes_all_code_cells(self):
        """mode: all で全コードセルが対象になる"""
        # ハンドラクラスが存在することを確認（Red フェーズでは失敗が期待される）
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteUpToMode:
    """mode: up_to で指定セルまでが実行される"""

    def test_mode_up_to_executes_cells_up_to_index(self):
        """mode: up_to で cell_index までのセルが対象になる"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteFromMode:
    """mode: from で指定セル以降が実行される"""

    def test_mode_from_executes_cells_from_index(self):
        """mode: from で cell_index 以降のセルが対象になる"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteMarkdownSkip:
    """Markdown セルがスキップされる"""

    def test_markdown_cells_are_skipped(self):
        """Markdown セルは実行対象に含まれない"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteMixedCells:
    """混在セル（code + markdown）で code のみ実行される"""

    def test_only_code_cells_are_executed_in_mixed(self):
        """code と markdown の混在時に code のみ実行される"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


# ============================================================
# 異常系テスト
# ============================================================


class TestBatchExecuteInvalidMode:
    """mode が不正値でバリデーションエラー"""

    def test_invalid_mode_returns_validation_error(self):
        """不正な mode 値が VALIDATION_ERROR になる"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteMissingCellIndex:
    """up_to/from で cell_index 未指定でバリデーションエラー"""

    def test_up_to_without_cell_index_returns_validation_error(self):
        """mode: up_to で cell_index 未指定は VALIDATION_ERROR"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"

    def test_from_without_cell_index_returns_validation_error(self):
        """mode: from で cell_index 未指定は VALIDATION_ERROR"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteCellIndexOutOfRange:
    """cell_index が範囲外でエラー"""

    def test_cell_index_out_of_range(self):
        """cell_index がセル数を超えている場合にエラー"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteErrorStops:
    """途中セルでエラー発生時に停止、failed_cell が返る"""

    def test_execution_stops_on_error_and_reports_failed_cell(self):
        """途中のセルでエラーが発生すると以降のセルは実行されず failed_cell が返る"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteNotNotebook:
    """ノートブック以外のファイル指定でエラー"""

    def test_non_notebook_file_returns_error(self):
        """ノートブックでないファイルを指定した場合にエラー"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"


class TestBatchExecuteKernelNotFound:
    """カーネルが存在しない場合のエラー"""

    def test_missing_kernel_returns_error(self):
        """存在しないカーネルを指定した場合にエラー"""
        handler_cls = getattr(_handlers, "ContentsCellExecuteBatchHandler", None)
        assert handler_cls is not None, "ContentsCellExecuteBatchHandler が未実装"
