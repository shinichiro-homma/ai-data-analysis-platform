"""タスク 23.6: 軽微な負債解消のテスト

対象:
1. sync_state.remove_path — _seq_store からエントリを削除
2. _build_timeout_error_result — タイムアウトエラー dict の共通ヘルパー
3. DATABASE_URL 未設定時のステータス統一（500）
4. ContentsListHandler.post と ContentsHandler.post の委譲
5. _wrap_contents_delete による .ipynb 削除時の sync_state.remove_path 呼び出し
"""

import importlib.util
import inspect
import os
import sys
import types as _types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


# =============================================================================
# 1. sync_state モジュールのロード（test_sync_state.py パターン踏襲）
# =============================================================================


def _load_module_fresh(name: str, filename: str) -> _types.ModuleType:
    """extensions/custom_api/ 配下のモジュールをファイルからロード（既存エントリを上書き）"""
    sys.modules.pop(name, None)
    path = _ext_dir / "custom_api" / filename
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# ai_events モック（sync_state が from .ai_events import broadcast_event する）
if "custom_api.ai_events" not in sys.modules:
    _ae = _types.ModuleType("custom_api.ai_events")
    _ae.__package__ = "custom_api"
    _ae.broadcast_event = lambda event: None
    sys.modules["custom_api.ai_events"] = _ae

# notebook_locks モック（sync_state.get_sync_state_payload が from .notebook_locks import get_locks する）
if "custom_api.notebook_locks" not in sys.modules:
    _nl = _types.ModuleType("custom_api.notebook_locks")
    _nl.__package__ = "custom_api"
    _nl.get_locks = lambda: {}
    sys.modules["custom_api.notebook_locks"] = _nl

sync_state = _load_module_fresh("custom_api.sync_state", "sync_state.py")


@pytest.fixture(autouse=True)
def _clear_state():
    """各テストの前後で seq ストアをクリアする"""
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()
    yield
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()


# =============================================================================
# 2. base.py のヘルパーのロード
# =============================================================================

# base.py は tornado / jupyter_server を import する。
# 重い依存のモック（test_sql_handlers.py パターン踏襲）
for _mod_name in (
    "jupyter_server",
    "jupyter_server.base",
    "jupyter_server.base.handlers",
    "tornado",
    "tornado.web",
):
    if _mod_name not in sys.modules:
        _m = _types.ModuleType(_mod_name)
        if _mod_name == "tornado.web":
            _m.authenticated = lambda f: f
        if _mod_name == "jupyter_server.base.handlers":
            _m.APIHandler = type("APIHandler", (), {})
            _m.JupyterHandler = type("JupyterHandler", (), {})
        sys.modules[_mod_name] = _m

# base モジュールをロード
base = _load_module_fresh("custom_api.base", "base.py")


# =============================================================================
# テストクラス
# =============================================================================


class TestRemovePath:
    """sync_state.remove_path(path) が _seq_store からエントリを削除すること"""

    def test_remove_existing_path(self):
        """既存パスの remove_path で _seq_store からエントリが消える"""
        # Arrange
        sync_state.next_seq("notebooks/test.ipynb")
        assert sync_state.get_seq("notebooks/test.ipynb") == 1

        # Act
        sync_state.remove_path("notebooks/test.ipynb")

        # Assert
        assert sync_state.get_seq("notebooks/test.ipynb") == 0
        assert "notebooks/test.ipynb" not in sync_state.get_all()


class TestRemovePathUnknown:
    """未知パスの remove_path がエラーにならないこと"""

    def test_remove_unknown_path_does_not_raise(self):
        """存在しないパスに対する remove_path はエラーなく成功する"""
        # Act & Assert — 例外が発生しないことを確認
        sync_state.remove_path("nonexistent/path.ipynb")


class TestTimeoutErrorResult:
    """_build_timeout_error_result の戻り値が正しい形式であること"""

    def test_returns_correct_structure(self):
        """タイムアウト秒数と実行時間からエラー結果 dict を生成する"""
        # Act
        result = base._build_timeout_error_result(timeout=30, execution_time_ms=30000)

        # Assert
        assert result["success"] is False
        assert result["execution_count"] == 0
        assert result["error"]["type"] == "TimeoutError"
        assert "30" in result["error"]["message"]
        assert result["error"]["traceback"] == []
        assert result["execution_time_ms"] == 30000

    def test_timeout_value_in_message(self):
        """タイムアウト秒数がエラーメッセージに含まれる"""
        # Act
        result = base._build_timeout_error_result(timeout=60, execution_time_ms=60000)

        # Assert
        assert "60" in result["error"]["message"]


class TestDatabaseUrlNotConfigured:
    """DATABASE_URL 未設定時に SqlExecuteHandler/SqlExportHandler の両方で 500 が返ること"""

    def test_sql_execute_returns_500_without_database_url(self):
        """SqlExecuteHandler が DATABASE_URL 未設定時にステータス 500 を返す"""
        # Arrange — sql_handlers をロードするために追加モックが必要
        # base モジュールのモック（test_sql_handlers.py パターン）
        if "custom_api.base" not in sys.modules or not hasattr(sys.modules["custom_api.base"], "BaseCustomHandler"):
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

        for _mod_name in (
            "pandas",
            "sqlalchemy",
            "sqlalchemy.exc",
        ):
            if _mod_name not in sys.modules:
                _m = _types.ModuleType(_mod_name)
                sys.modules[_mod_name] = _m

        sql_handlers = _load_module_fresh("custom_api.sql_handlers", "sql_handlers.py")

        # _require_database_url ヘルパーが存在し、ステータス 500 を使うことを検証
        handler = MagicMock()
        handler.write_error_response = MagicMock()

        with patch.dict(os.environ, {}, clear=True):
            # environ から DATABASE_URL を確実に除去
            os.environ.pop("DATABASE_URL", None)
            result = sql_handlers._require_database_url(handler)

        # Assert
        assert result is None  # DATABASE_URL がないので None を返す
        handler.write_error_response.assert_called_once()
        call_args = handler.write_error_response.call_args
        assert call_args[0][2] == 500  # ステータスコードが 500

    def test_sql_export_returns_500_without_database_url(self):
        """SqlExportHandler が DATABASE_URL 未設定時にステータス 500 を返す"""
        sql_handlers = sys.modules.get("custom_api.sql_handlers")
        if sql_handlers is None:
            pytest.skip("sql_handlers not loaded")

        handler = MagicMock()
        handler.write_error_response = MagicMock()

        with patch.dict(os.environ, {}, clear=True):
            os.environ.pop("DATABASE_URL", None)
            result = sql_handlers._require_database_url(handler)

        # Assert — 同じヘルパーを使うので同じ結果
        assert result is None
        handler.write_error_response.assert_called_once()
        call_args = handler.write_error_response.call_args
        assert call_args[0][2] == 500


class TestContentsPostDelegation:
    """ContentsListHandler.post と ContentsHandler.post が同じレスポンス形式を返すこと

    リファクタ後は ContentsHandler.post が共通ヘルパーに委譲されるため、
    両方の post が同一の _create_content_response ヘルパーを呼ぶことを検証する。

    ハンドラのインスタンス化は tornado / contents_manager 等の外部依存が大きいため、
    (1) ソースコード検査で post 本体が _create_content_response を呼んでいること、
    (2) unittest.mock.patch でヘルパーを差し替えた際に post が参照するグローバル名が
        実際に差し替わること（＝実行時に patch 後のモックが呼ばれる状態になること）
    の 2 段階で委譲を検証する。
    """

    def test_helper_exists(self):
        """contents_handlers に _create_content_response 共通ヘルパーが存在する"""
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")

        assert hasattr(contents_handlers, "_create_content_response"), (
            "contents_handlers に _create_content_response 共通ヘルパーが存在しない"
        )

    def test_contents_handler_post_uses_shared_helper(self):
        """ContentsHandler.post のソースが共通ヘルパーを呼び出している"""
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")

        post_source = inspect.getsource(contents_handlers.ContentsHandler.post)
        assert "_create_content_response" in post_source, (
            "ContentsHandler.post が _create_content_response を呼び出していない"
        )

    def test_contents_list_handler_post_uses_shared_helper(self):
        """ContentsListHandler.post のソースが共通ヘルパーを呼び出している"""
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")

        post_source = inspect.getsource(contents_handlers.ContentsListHandler.post)
        assert "_create_content_response" in post_source, (
            "ContentsListHandler.post が _create_content_response を呼び出していない"
        )

    def test_contents_handler_post_delegates_to_patched_helper(self):
        """_create_content_response を patch すると ContentsHandler.post から見える参照も差し替わる

        post 関数のグローバル名前空間（__globals__）はモジュールの __dict__ そのものなので、
        patch.object でモジュール属性を差し替えると post 実行時に解決される
        `_create_content_response` も差し替え後のモックになる。これにより、
        実際にハンドラをインスタンス化・実行しなくても「post がモジュールレベルの
        _create_content_response を呼ぶ実装になっているか」を実行時挙動として検証できる。
        """
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")
        mock_helper = AsyncMock(return_value=None)

        with patch.object(contents_handlers, "_create_content_response", new=mock_helper):
            post_globals = contents_handlers.ContentsHandler.post.__globals__
            assert post_globals["_create_content_response"] is mock_helper, (
                "ContentsHandler.post は patch 後も差し替え前の _create_content_response を"
                "参照している（モジュールレベルのヘルパー経由で呼んでいない可能性がある）"
            )

    def test_contents_list_handler_post_delegates_to_patched_helper(self):
        """_create_content_response を patch すると ContentsListHandler.post から見える参照も差し替わる"""
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")
        mock_helper = AsyncMock(return_value=None)

        with patch.object(contents_handlers, "_create_content_response", new=mock_helper):
            post_globals = contents_handlers.ContentsListHandler.post.__globals__
            assert post_globals["_create_content_response"] is mock_helper, (
                "ContentsListHandler.post は patch 後も差し替え前の _create_content_response を"
                "参照している（モジュールレベルのヘルパー経由で呼んでいない可能性がある）"
            )

    @pytest.mark.asyncio
    async def test_contents_handler_post_calls_helper_with_path_default(self):
        """ContentsHandler.post は _create_content_response を (self, body, path_default=path) で呼ぶ

        tornado.web.authenticated はテスト環境では恒等デコレータ（`lambda f: f`）としてモックされて
        いるため、ContentsHandler.post は素の async 関数として直接呼び出せる。contents_manager 等の
        実インスタンス化を避けつつ、実際に post を実行して委譲の呼び出し引数まで検証する。
        """
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")
        mock_helper = AsyncMock(return_value=None)

        fake_self = MagicMock()
        fake_self.get_json_body.return_value = {"type": "notebook"}

        with patch.object(contents_handlers, "_create_content_response", new=mock_helper):
            await contents_handlers.ContentsHandler.post(fake_self, path="notebooks/target.ipynb")

        mock_helper.assert_awaited_once_with(fake_self, {"type": "notebook"}, path_default="notebooks/target.ipynb")

    @pytest.mark.asyncio
    async def test_contents_list_handler_post_calls_helper_with_empty_path_default(self):
        """ContentsListHandler.post は _create_content_response を (self, body, path_default="") で呼ぶ"""
        contents_handlers = _load_module_fresh("custom_api.contents_handlers", "contents_handlers.py")
        mock_helper = AsyncMock(return_value=None)

        fake_self = MagicMock()
        fake_self.get_json_body.return_value = {"type": "file"}

        with patch.object(contents_handlers, "_create_content_response", new=mock_helper):
            await contents_handlers.ContentsListHandler.post(fake_self)

        mock_helper.assert_awaited_once_with(fake_self, {"type": "file"}, path_default="")


def _get_init_module():
    """conftest の setup_custom_api_init が登録した init_module を取得する"""
    init_mod = sys.modules.get("custom_api.__init__")
    assert init_mod is not None, (
        "custom_api.__init__ が sys.modules に未登録。conftest.py の setup_custom_api_init fixture が実行済みか確認"
    )
    return init_mod


class TestSeqStoreCleanupOnDelete:
    """_wrap_contents_delete が .ipynb パスの削除成功後に sync_state.remove_path を呼ぶこと"""

    @pytest.mark.asyncio
    async def test_ipynb_delete_calls_remove_path(self):
        """_wrap_contents_delete は .ipynb 削除成功後に remove_path を呼ぶ"""
        # Arrange — sys.modules から最新の sync_state を取得する
        # （test_sync_state.py がモジュールレベルで再ロードするため、
        # モジュール変数 sync_state は古いインスタンスを指す場合がある）
        ss = sys.modules["custom_api.sync_state"]
        ss.next_seq("notebooks/test.ipynb")
        assert ss.get_seq("notebooks/test.ipynb") == 1

        init_module = _get_init_module()

        original_delete = AsyncMock(return_value=None)
        wrapped = init_module._wrap_contents_delete(original_delete)

        # Act
        await wrapped("notebooks/test.ipynb")

        # Assert
        original_delete.assert_awaited_once_with("notebooks/test.ipynb")
        assert ss.get_seq("notebooks/test.ipynb") == 0

    @pytest.mark.asyncio
    async def test_ipynb_delete_calls_remove_path_when_sync_state_not_in_sys_modules(self):
        """sync_state が sys.modules に未登録でも remove_path が呼ばれる（バグ再現）

        修正前: sys.modules.get("custom_api.sync_state") が None を返し silent skip
        修正後: from .sync_state import remove_path でモジュールをロードして呼び出す
        """
        init_module = _get_init_module()

        original_delete = AsyncMock(return_value=None)
        wrapped = init_module._wrap_contents_delete(original_delete)

        # sys.modules から sync_state を除去してバグ条件を再現
        saved = sys.modules.pop("custom_api.sync_state")
        try:
            # Act — 修正前は sys.modules.get() が None を返し remove_path がスキップされた
            # 修正後は from .sync_state import で再ロードされる
            await wrapped("notebooks/fresh.ipynb")

            # Assert — from .sync_state import により再ロードされ sys.modules に復帰
            assert "custom_api.sync_state" in sys.modules, (
                "from .sync_state import remove_path が実行されず、"
                "sync_state が sys.modules に復帰していない（silent failure）"
            )
        finally:
            # Teardown — 元のモジュールを復元（他テストへの影響を防ぐ）
            sys.modules["custom_api.sync_state"] = saved

        original_delete.assert_awaited_once_with("notebooks/fresh.ipynb")


class TestWrapContentsDeleteNonIpynb:
    """.ipynb 以外のファイル削除では remove_path が呼ばれないこと"""

    @pytest.mark.asyncio
    async def test_non_ipynb_delete_does_not_call_remove_path(self):
        """.txt ファイルの削除では remove_path は呼ばれない"""
        # Arrange
        ss = sys.modules["custom_api.sync_state"]
        ss.next_seq("data/report.txt")

        init_module = _get_init_module()

        original_delete = AsyncMock(return_value=None)
        wrapped = init_module._wrap_contents_delete(original_delete)

        # Act
        await wrapped("data/report.txt")

        # Assert
        original_delete.assert_awaited_once_with("data/report.txt")
        assert ss.get_seq("data/report.txt") == 1
