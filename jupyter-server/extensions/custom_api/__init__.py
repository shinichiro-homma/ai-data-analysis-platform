"""
Custom API Extension for Jupyter Server

api-contracts.md に定義された REST API を提供する Jupyter Server 拡張機能。
"""

from .handlers import get_handlers


def _jupyter_server_extension_points():
    """Jupyter Server 拡張機能のエントリーポイント"""
    return [{"module": "custom_api"}]


def _load_jupyter_server_extension(server_app):
    """拡張機能をロード"""
    web_app = server_app.web_app
    host_pattern = ".*$"

    # ハンドラーを登録
    handlers = get_handlers(web_app.settings["base_url"].rstrip("/"))
    web_app.add_handlers(host_pattern, handlers)

    server_app.log.info("Custom API extension loaded")


# 後方互換性のためのエイリアス
load_jupyter_server_extension = _load_jupyter_server_extension
