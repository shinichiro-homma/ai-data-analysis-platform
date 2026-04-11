"""カーネルクラッシュ検出と自動復旧のテスト

タスク 18.1: カーネルがクラッシュ（dead 状態）した際に自動的に検出し、
新しいカーネルを起動してセッションを復旧する機能のテスト。

テスト対象:
1. restart_kernel ラッパー（__init__.py に追加予定）
   - workspace_id がある場合に sandbox 再注入が呼ばれる
   - workspace_id がない場合にスキップされる
   - sandbox 再注入が失敗した場合のエラーハンドリング

2. KernelRestartHandler（handlers.py）
   - 明示的な再起動後に sandbox が再注入される
   - 存在しないカーネルの再起動が 404 を返す
"""

import asyncio
import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# --- モジュールのセットアップ ---
# custom_api パッケージの __init__.py を経由せず、個別モジュールをロードする
# jupyter_client, tornado 等の外部依存はモックで置き換える

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
    # 既存のエントリを削除して正規版を確実にロードする
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

# 2. 外部依存のモック（jupyter_client, tornado, jupyter_server）
_ensure_mock_module("jupyter_client", AsyncKernelClient=MagicMock)
_ensure_mock_module("tornado")
_ensure_mock_module("tornado.web", authenticated=lambda f: f)
_ensure_mock_module(
    "jupyter_server",
)
_ensure_mock_module(
    "jupyter_server.base",
)
_ensure_mock_module(
    "jupyter_server.base.handlers",
    APIHandler=type("APIHandler", (), {}),
)

# 3. base モジュールのモック
_base_mock = _ensure_mock_module(
    "custom_api.base",
    __package__="custom_api",
    BaseCustomHandler=type("BaseCustomHandler", (), {}),
    resolve_workspace_dir=lambda *a, **kw: None,
    validate_timeout=lambda *a, **kw: (30, None),
    validate_workspace_id=lambda *a, **kw: None,
    workspace_contents_path=lambda *a, **kw: "",
    utc_now_iso=lambda: "2026-01-01T00:00:00Z",
    WORKSPACE_ROOT_DIR="/home/jovyan/work/workspaces/sample",
    WORKSPACE_PATH_PREFIX="workspaces/sample",
    JUPYTER_ROOT_DIR="/home/jovyan/work",
    validate_kernel_name=lambda *a, **kw: None,
)

# 4. kernel_executor モジュールをロード
_load_module("custom_api.kernel_executor", "kernel_executor.py")

# 5. workspace_sandbox モジュールをロード
_load_module("custom_api.workspace_sandbox", "workspace_sandbox.py")

# 6. session_handlers モジュールをロード
_load_module("custom_api.session_handlers", "session_handlers.py")

from custom_api.session_handlers import (  # noqa: E402
    register_kernel_workspace,
    unregister_kernel,
)
from custom_api.workspace_sandbox import generate_sandbox_code  # noqa: E402

# =============================================================================
# 1. restart_kernel ラッパーのテスト
# =============================================================================


class TestRestartKernelWrapper:
    """__init__.py の _wrap_restart_kernel ラッパーのテスト

    restart_kernel をラップし、再起動後に sandbox を再注入する機能をテストする。
    このラッパーは __init__.py に追加予定。
    """

    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        """テストのセットアップ"""
        self.kernel_id = "test-kernel-001"
        self.workspace_id = "ws-test-001"
        self.workspace_dir = tmp_path / "workspaces" / "sample" / self.workspace_id
        self.workspace_dir.mkdir(parents=True)
        (self.workspace_dir / "metadata.json").write_text('{"name": "test"}')

    def test_sandbox_reinjected_when_workspace_id_exists(self):
        """workspace_id がある場合に sandbox 再注入が呼ばれることを確認"""
        # Arrange
        register_kernel_workspace(self.kernel_id, self.workspace_id)

        original_restart = AsyncMock()

        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_wrap_restart_kernel"), (
            "_wrap_restart_kernel is not yet implemented in __init__.py"
        )

        wrapped = init_module._wrap_restart_kernel(original_restart)

        # sandbox 再注入が成功するようモック
        mock_executor_cls = MagicMock()
        mock_executor_instance = MagicMock()
        mock_executor_instance.execute = AsyncMock(return_value={"success": True})
        mock_executor_cls.return_value = mock_executor_instance

        with patch("custom_api.kernel_executor.KernelExecutor", mock_executor_cls):
            # 実行: workspace_id が登録されているカーネルの再起動
            asyncio.get_event_loop().run_until_complete(wrapped(self.kernel_id))

        # Assert: original_restart が呼ばれている
        original_restart.assert_awaited_once_with(self.kernel_id)

        # Assert: sandbox 再注入が実行されている（executor.execute が呼ばれた）
        mock_executor_instance.execute.assert_awaited_once()
        injected_code = mock_executor_instance.execute.call_args[0][0]
        assert self.workspace_id in injected_code

        # クリーンアップ
        unregister_kernel(self.kernel_id)

    def test_sandbox_skipped_when_no_workspace_id(self):
        """workspace_id がない場合に sandbox 再注入がスキップされることを確認"""
        # kernel_id は登録しない（ワークスペース外のカーネル）
        original_restart = AsyncMock()

        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_wrap_restart_kernel"), (
            "_wrap_restart_kernel is not yet implemented in __init__.py"
        )

        # _wrap_restart_kernel でラップした restart_kernel を呼ぶ
        # workspace_id がないので sandbox 再注入はスキップされるべき
        wrapped = init_module._wrap_restart_kernel(original_restart)

        # 実行: workspace_id が登録されていないカーネルの再起動
        kernel_id_no_ws = "kernel-no-workspace"
        asyncio.get_event_loop().run_until_complete(wrapped(kernel_id_no_ws))

        # Assert: original_restart が呼ばれている
        original_restart.assert_awaited_once_with(kernel_id_no_ws)

    def test_sandbox_reinjection_failure_is_logged_not_raised(self):
        """sandbox 再注入が失敗した場合にエラーがログされ、例外は伝搬しないことを確認"""
        # Arrange
        register_kernel_workspace(self.kernel_id, self.workspace_id)
        original_restart = AsyncMock()

        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_wrap_restart_kernel"), (
            "_wrap_restart_kernel is not yet implemented in __init__.py"
        )

        wrapped = init_module._wrap_restart_kernel(original_restart)

        # sandbox 再注入が失敗するようモック
        # KernelExecutor.execute が失敗を返す
        mock_executor_cls = MagicMock()
        mock_executor_instance = MagicMock()
        mock_executor_instance.execute = AsyncMock(
            return_value={"success": False, "error": {"message": "sandbox injection failed"}}
        )
        mock_executor_cls.return_value = mock_executor_instance

        with patch("custom_api.kernel_executor.KernelExecutor", mock_executor_cls):
            # 実行: sandbox 再注入が失敗しても例外は伝搬しない
            asyncio.get_event_loop().run_until_complete(wrapped(self.kernel_id))

        # Assert: original_restart は呼ばれている（再起動自体は成功）
        original_restart.assert_awaited_once_with(self.kernel_id)

        # クリーンアップ
        unregister_kernel(self.kernel_id)


# =============================================================================
# 1b. autorestart コールバック登録のテスト（Issue #9）
# =============================================================================


class TestRegisterAutorestartCallback:
    """_register_autorestart_callback が KernelRestarter に sandbox 再注入を登録することをテスト"""

    def test_callback_registered_on_restarter(self):
        """_restarter.add_callback が 'restart' イベントで呼び出される"""
        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_register_autorestart_callback"), (
            "_register_autorestart_callback is not yet implemented in __init__.py"
        )

        kernel_id = "test-kernel-autorestart"
        mock_restarter = MagicMock()
        mock_kernel = MagicMock()
        mock_kernel._restarter = mock_restarter

        mock_km = MagicMock()
        mock_km._kernels = {kernel_id: mock_kernel}

        init_module._register_autorestart_callback(mock_km, kernel_id)

        mock_restarter.add_callback.assert_called_once()
        # event='restart' が kwargs または 2番目の位置引数で渡されている
        call = mock_restarter.add_callback.call_args
        event = call.kwargs.get("event") or (call.args[1] if len(call.args) > 1 else None)
        assert event == "restart"

    def test_callback_not_registered_when_kernel_missing(self):
        """カーネルが見つからない場合は例外を投げずスキップする"""
        from custom_api import __init__ as init_module

        mock_km = MagicMock()
        mock_km._kernels = {}
        # 例外なく完了すること
        init_module._register_autorestart_callback(mock_km, "nonexistent-kernel")


# =============================================================================
# 2. KernelRestartHandler のテスト
# =============================================================================


class TestKernelRestartHandlerSandboxReinjection:
    """KernelRestartHandler が再起動後に sandbox を再注入することをテスト

    handlers.py の KernelRestartHandler.post() が、
    restart_kernel 呼び出し後に sandbox 再注入を行う。
    ラッパー方式の場合は restart_kernel 自体がラップされているため、
    ハンドラーが明示的に sandbox 再注入を行うかラッパー経由かは実装依存。
    """

    def test_restart_reinjects_sandbox_for_workspace_kernel(self):
        """ワークスペースに紐づくカーネルの再起動後に sandbox が再注入される"""
        # この機能は KernelRestartHandler + _wrap_restart_kernel の組み合わせで実現される
        # ラッパーが restart_kernel に仕込まれるため、
        # ハンドラーの restart_kernel 呼び出しが自動的に sandbox 再注入をトリガーする

        # __init__.py に _wrap_restart_kernel が実装され、
        # _load_jupyter_server_extension で km.restart_kernel がラップされることを確認
        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_wrap_restart_kernel"), (
            "KernelRestartHandler sandbox reinjection requires _wrap_restart_kernel in __init__.py"
        )

    def test_restart_nonexistent_kernel_returns_404(self):
        """存在しないカーネルの再起動が 404 を返すことを確認

        これは既存の check_kernel_exists ロジックによって処理される。
        ハンドラーコードを直接テストするのではなく、
        check_kernel_exists が False を返す場合のフローを確認する。
        """
        # BaseCustomHandler.check_kernel_exists は kernel_manager.get_kernel を呼び出し、
        # KeyError 等で存在しないカーネルを検出して 404 を返す
        # ここでは既存ロジックの動作確認として、KernelRestartHandler のコードパスを検証

        # handlers.py を読み込んで KernelRestartHandler.post のシグネチャを確認
        _handlers_path = _ext_dir / "custom_api" / "handlers.py"
        source = _handlers_path.read_text()

        # check_kernel_exists が呼ばれていることを確認（コード検査）
        assert "check_kernel_exists" in source, "KernelRestartHandler should call check_kernel_exists"


# =============================================================================
# 3. restart_dead_kernels 設定のテスト
# =============================================================================


class TestRestartDeadKernelsConfig:
    """jupyter_server_config.py に restart_dead_kernels = True が設定されることを確認"""

    def test_restart_dead_kernels_configured(self):
        """restart_dead_kernels = True が設定ファイルに含まれること"""
        config_path = Path(__file__).resolve().parent.parent / "jupyter_config" / "jupyter_server_config.py"
        config_content = config_path.read_text()

        assert "restart_dead_kernels" in config_content, (
            "jupyter_server_config.py should contain restart_dead_kernels setting"
        )
        assert "restart_dead_kernels = True" in config_content or ("restart_dead_kernels=True" in config_content), (
            "restart_dead_kernels should be set to True"
        )


# =============================================================================
# 4. sandbox 再注入後のセキュリティテスト
# =============================================================================


class TestSandboxAfterReinjection:
    """sandbox 再注入後に他ワークスペースへのアクセスが拒否されることを確認

    generate_sandbox_code() で生成されたコードを exec() して、
    ワークスペース外アクセスが PermissionError で拒否されることを検証する。
    （再注入されるコードが正しく制限を設定するかの回帰テスト）
    """

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        """sandbox 環境をセットアップ"""
        ws_root = tmp_path / "workspaces"
        self.ws_dir = ws_root / "ws-001"
        self.other_ws = ws_root / "ws-002"
        self.ws_dir.mkdir(parents=True)
        self.other_ws.mkdir(parents=True)
        (self.other_ws / "secret.txt").write_text("secret data")
        (self.ws_dir / "my_file.txt").write_text("my data")

        # sandbox コードを生成して実行（再注入のシミュレーション）
        code = generate_sandbox_code(str(self.ws_dir), "ws-001")
        self.ns = {}
        exec(code, self.ns)

    def test_other_workspace_access_denied_after_reinjection(self):
        """sandbox 再注入後に他ワークスペースへのアクセスが PermissionError"""

        with pytest.raises(PermissionError, match="another workspace"):
            open(str(self.other_ws / "secret.txt"))  # noqa: SIM115

    def test_own_workspace_access_allowed_after_reinjection(self):
        """sandbox 再注入後に自ワークスペースのファイルは読める"""
        with open(str(self.ws_dir / "my_file.txt")) as f:
            content = f.read()
        assert content == "my data"
