"""
Custom API Extension for Jupyter Server

api-contracts.md に定義された REST API を提供する Jupyter Server 拡張機能。
"""

import asyncio
import functools
import logging
import sys
from collections.abc import Awaitable, Callable
from typing import Any

from . import kernel_executor as _kernel_executor_module
from . import notebook_locks
from .handlers import get_handlers
from .session_handlers import get_kernel_workspace, unregister_kernel
from .workspace_sandbox import generate_sandbox_code

log = logging.getLogger(__name__)

# 失効スイーパーの実行間隔（秒）
_LOCK_SWEEP_INTERVAL = 5

# 失効スイーパータスクへの強参照（GC 回収防止）。拡張ロード時に代入される（バグ 4）。
_lock_sweeper_task = None


def _resolve_http_error():
    """tornado.web.HTTPError を解決する。

    テストでは tornado.web がモックされ HTTPError を持たない場合があるため、
    その際は status_code 属性を持つ互換例外クラスにフォールバックする。
    """
    try:
        from tornado.web import HTTPError

        return HTTPError
    except (ImportError, AttributeError):

        class _HTTPError(Exception):
            def __init__(self, status_code, *args, **kwargs):
                super().__init__(*args)
                self.status_code = status_code

        return _HTTPError


def _wrap_contents_save(original_save):
    """contents_manager.save をラップし、ロック中ノートブックへの不正な書き込みを 423 で拒否する。

    正当な書き込みは lock_token_ctx（ContextVar）に設定されたトークンで識別する。
    検査対象は .ipynb パスに限定し、それ以外（データファイル等）は貫通させる（不変条件 I2）。
    """
    http_error_cls = _resolve_http_error()

    @functools.wraps(original_save)
    async def wrapper(model, path, *args, **kwargs):
        # ロックストアは sys.modules から解決する（テストが importlib で再ロードした
        # インスタンスと同一の _locks / ContextVar を参照するため）。
        locks = sys.modules.get("custom_api.notebook_locks", notebook_locks)
        # 検査対象は .ipynb のみ（それ以外は貫通）
        if isinstance(path, str) and path.endswith(".ipynb"):
            normalized_path = locks.normalize_notebook_path(path)
            expected_token = locks.get_lock_token(normalized_path)
            # ロック中: ContextVar のトークンが一致しない書き込みは拒否
            if expected_token is not None and locks.lock_token_ctx.get() != expected_token:
                raise http_error_cls(423, f"Notebook is locked: {path}")
        result = await original_save(model, path, *args, **kwargs)
        # .ipynb の保存成功後に notebook_changed イベントを配信する
        if isinstance(path, str) and path.endswith(".ipynb"):
            try:
                from .sync_state import notify_notebook_changed

                notify_notebook_changed(path)
            except Exception:
                log.error("Failed to notify notebook_changed for %s", path, exc_info=True)
        return result

    return wrapper


async def _lock_sweeper_loop() -> None:
    """失効したロックを定期的に除去し、失効時に lock_released を配信する。"""
    from .ai_events import broadcast_event

    while True:
        try:
            await asyncio.sleep(_LOCK_SWEEP_INTERVAL)
            expired = notebook_locks.sweep_expired(now=notebook_locks.now())
            for path in expired:
                broadcast_event({"type": "lock_released", "notebook_path": path})
                log.info("Lock expired and released for %s", path)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.error("Error in lock sweeper loop", exc_info=True)


def _jupyter_server_extension_points():
    """Jupyter Server 拡張機能のエントリーポイント"""
    return [{"module": "custom_api"}]


def _wrap_shutdown_kernel(original_method):
    """shutdown_kernel をラップし、culler による停止時にもクリーンアップを実行する"""

    @functools.wraps(original_method)
    async def wrapper(kernel_id, *args, **kwargs):
        try:
            return await original_method(kernel_id, *args, **kwargs)
        finally:
            unregister_kernel(kernel_id)
            log.info("Cleaned up state for culled kernel %s", kernel_id)

    return wrapper


async def _reinject_sandbox(
    kernel_id: str,
    workspace_id: str,
    kernel_manager: Any,
    context: str,
) -> None:
    """sandbox 再注入の共通処理（明示 restart / autorestart 両パスで使用）"""
    try:
        # IOPub チャンネル準備を待機（session_handlers.py の既存パターンに倣う）
        await asyncio.sleep(2)

        # 循環インポート回避のため関数内でインポート
        from .base import resolve_workspace_dir

        workspace_dir = str(resolve_workspace_dir(workspace_id))
        sandbox_code = generate_sandbox_code(workspace_dir, workspace_id)
        executor = _kernel_executor_module.KernelExecutor(kernel_id, kernel_manager)
        sandbox_result = await executor.execute(sandbox_code, timeout=30)
        if not sandbox_result.get("success"):
            error_msg = sandbox_result.get("error", {}).get("message", "Unknown error")
            log.error(
                "Sandbox re-injection failed after %s for kernel %s (workspace %s): %s",
                context,
                kernel_id,
                workspace_id,
                error_msg,
            )
        else:
            log.info(
                "Sandbox re-injected after %s for kernel %s (workspace %s)",
                context,
                kernel_id,
                workspace_id,
            )
    except Exception:
        log.error(
            "Sandbox re-injection raised an exception after %s for kernel %s (workspace %s)",
            context,
            kernel_id,
            workspace_id,
            exc_info=True,
        )


def _register_autorestart_callback(kernel_manager: Any, kernel_id: str) -> None:
    """KernelRestarter の 'restart' イベントに sandbox 再注入コールバックを登録する

    `restart_dead_kernels=True` により dead カーネルが自動復旧する際、`KernelRestarter`
    は `MappingKernelManager.restart_kernel()` を経由せず KernelManager の内部起動処理を
    直接呼び出す。このため `_wrap_restart_kernel` の wrapper は発火せず sandbox が再注入
    されない。`_restarter.add_callback(event='restart')` で autorestart イベントを直接
    フックすることでこのギャップを埋める。
    """
    try:
        kernel = kernel_manager._kernels.get(kernel_id) if hasattr(kernel_manager, "_kernels") else None
        if kernel is None:
            log.debug("Cannot register autorestart callback: kernel %s not found", kernel_id)
            return
        restarter = getattr(kernel, "_restarter", None)
        if restarter is None:
            log.debug("Cannot register autorestart callback: restarter unavailable for kernel %s", kernel_id)
            return

        def on_autorestart() -> None:
            workspace_id = get_kernel_workspace(kernel_id)
            if workspace_id is None:
                return
            asyncio.ensure_future(_reinject_sandbox(kernel_id, workspace_id, kernel_manager, "autorestart"))

        restarter.add_callback(on_autorestart, event="restart")
        log.info("Registered autorestart sandbox re-injection callback for kernel %s", kernel_id)
    except Exception:
        log.error(
            "Failed to register autorestart callback for kernel %s",
            kernel_id,
            exc_info=True,
        )


def _wrap_start_kernel(
    original_method: Callable[..., Awaitable[str]],
    kernel_manager: Any,
) -> Callable[..., Awaitable[str]]:
    """start_kernel をラップし、カーネル起動後に autorestart コールバックを登録する"""

    @functools.wraps(original_method)
    async def wrapper(*args, **kwargs):
        kernel_id = await original_method(*args, **kwargs)
        _register_autorestart_callback(kernel_manager, kernel_id)
        return kernel_id

    return wrapper


def _wrap_restart_kernel(
    original_method: Callable[..., Awaitable[None]],
    kernel_manager: Any = None,
) -> Callable[..., Awaitable[None]]:
    """restart_kernel をラップし、再起動後にワークスペース sandbox を再注入する"""

    @functools.wraps(original_method)
    async def wrapper(kernel_id, *args, **kwargs):
        result = await original_method(kernel_id, *args, **kwargs)

        # workspace_id が登録されている場合のみ sandbox 再注入を行う
        workspace_id = get_kernel_workspace(kernel_id)
        if workspace_id is None:
            return result

        await _reinject_sandbox(kernel_id, workspace_id, kernel_manager, "kernel restart")

        # restart 後に _restarter が差し替わる可能性があるため autorestart コールバックを再登録する
        if kernel_manager is not None:
            _register_autorestart_callback(kernel_manager, kernel_id)

        return result

    return wrapper


def _load_jupyter_server_extension(server_app):
    """拡張機能をロード"""
    web_app = server_app.web_app
    host_pattern = ".*$"

    # ハンドラーを登録
    handlers = get_handlers(web_app.settings["base_url"].rstrip("/"))
    web_app.add_handlers(host_pattern, handlers)

    # culler による shutdown_kernel 時にもクリーンアップが実行されるようフックする
    km = server_app.kernel_manager
    km.shutdown_kernel = _wrap_shutdown_kernel(km.shutdown_kernel)

    # カーネル起動後に autorestart イベント用コールバックを登録するようフックする
    km.start_kernel = _wrap_start_kernel(km.start_kernel, kernel_manager=km)

    # カーネル再起動後に sandbox を再注入するようフックする
    km.restart_kernel = _wrap_restart_kernel(km.restart_kernel, kernel_manager=km)

    # ノートブックロックをサーバー側で強制する（不変条件 I2）。
    # 標準 /api/contents 保存・カスタム API を含むすべての書き込みが通る単一チョークポイント。
    cm = server_app.contents_manager
    cm.save = _wrap_contents_save(cm.save)

    # ロック失効スイーパーを起動する（TTL 失効の根絶と lock_released 配信）。
    # タスクへの強参照を保持しないと GC に実行中タスクを回収され得るため、
    # モジュールレベル変数に保持する（バグ 4: Python 公式ドキュメント記載の落とし穴）。
    global _lock_sweeper_task
    _lock_sweeper_task = asyncio.ensure_future(_lock_sweeper_loop())

    log.info("Custom API extension loaded")


# 後方互換性のためのエイリアス
load_jupyter_server_extension = _load_jupyter_server_extension
