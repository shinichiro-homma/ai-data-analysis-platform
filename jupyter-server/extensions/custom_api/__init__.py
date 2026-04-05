"""
Custom API Extension for Jupyter Server

api-contracts.md に定義された REST API を提供する Jupyter Server 拡張機能。
"""

import asyncio
import functools
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from . import kernel_executor as _kernel_executor_module
from .handlers import get_handlers
from .session_handlers import get_kernel_workspace, unregister_kernel
from .workspace_sandbox import generate_sandbox_code

log = logging.getLogger(__name__)


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
                    "Sandbox re-injection failed after kernel restart for kernel %s (workspace %s): %s",
                    kernel_id,
                    workspace_id,
                    error_msg,
                )
        except Exception:
            log.error(
                "Sandbox re-injection raised an exception after kernel restart for kernel %s (workspace %s)",
                kernel_id,
                workspace_id,
                exc_info=True,
            )

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

    # カーネル再起動後に sandbox を再注入するようフックする
    km.restart_kernel = _wrap_restart_kernel(km.restart_kernel, kernel_manager=km)

    log.info("Custom API extension loaded")


# 後方互換性のためのエイリアス
load_jupyter_server_extension = _load_jupyter_server_extension
