"""
Custom API Extension for Jupyter Server

api-contracts.md に定義された REST API を提供する Jupyter Server 拡張機能。
"""

import functools
import logging

from .handlers import get_handlers
from .session_handlers import unregister_kernel

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

    log.info("Custom API extension loaded")


# 後方互換性のためのエイリアス
load_jupyter_server_extension = _load_jupyter_server_extension
