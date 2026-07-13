"""
AI同期イベント配信のためのWebSocket/RESTハンドラー
"""

import json
import logging

from tornado import web, websocket

from .base import BaseCustomHandler

logger = logging.getLogger(__name__)

# イベント type の許可リスト（SSoT）
ALLOWED_EVENT_TYPES = frozenset(
    {
        "notebook_changed",
        "cell_execute_start",
        "cell_execute_end",
        "lock_acquired",
        "lock_released",
    }
)

# WebSocket接続を管理するグローバルset
_websocket_clients = set()


def broadcast_event(event: dict) -> int:
    """接続中のすべての WebSocket クライアントにイベントを配信する。

    ロック取得/解放/失効通知（lock_acquired / lock_released）等、
    RESTハンドラー以外からの配信口として使用する。

    Returns:
        配信に成功したクライアント数。
    """
    payload = json.dumps(event)
    broadcasted_count = 0
    for client in _websocket_clients:
        try:
            client.write_message(payload)
            broadcasted_count += 1
        except Exception as e:
            logger.error(f"Failed to send message to WebSocket client: {e}")
    return broadcasted_count


class AiEventsWebSocketHandler(websocket.WebSocketHandler):
    """
    AI同期イベント配信用WebSocketハンドラー

    クライアント（JupyterLab拡張）がこのエンドポイントに接続し、
    AI操作イベントをリアルタイムで受信する。
    """

    def check_origin(self, origin):
        """CORS: すべてのオリジンを許可"""
        return True

    def open(self):
        """WebSocket接続確立時"""
        # クエリパラメータからトークンを取得
        token = self.get_argument("token", None)

        # 認証チェック（jupyter-serverのトークンと照合）
        expected_token = self.settings.get("token", "")

        if not token:
            logger.warning("WebSocket connection rejected: no token provided")
            self.close(code=1008, reason="Authentication required")
            return

        # トークンを検証（空のトークンは許可しない）
        if expected_token and token != expected_token:
            logger.warning("WebSocket connection rejected: invalid token")
            self.close(code=1008, reason="Authentication failed")
            return

        # 接続を登録
        _websocket_clients.add(self)
        logger.info(f"WebSocket client connected. Total clients: {len(_websocket_clients)}")

    def on_message(self, message):
        """
        クライアントからのメッセージ受信

        このWebSocketはサーバー→クライアントの一方向配信のため、
        クライアントからのメッセージは想定していない。
        """
        logger.debug(f"Received unexpected message from client: {message}")

    def on_close(self):
        """WebSocket接続切断時"""
        _websocket_clients.discard(self)
        logger.info(f"WebSocket client disconnected. Total clients: {len(_websocket_clients)}")


class AiEventsPostHandler(BaseCustomHandler):
    """
    AI同期イベント送信用RESTハンドラー

    MCPサーバー（jupyter-mcp）がこのエンドポイントにイベントをPOSTすると、
    接続中のすべてのWebSocketクライアントにブロードキャストする。
    """

    @web.authenticated
    async def post(self):
        """
        イベントをブロードキャスト

        Request Body:
        {
            "type": "notebook_changed",
            "notebook_path": "/path/to/notebook.ipynb",
            "seq": 1
        }

        Response:
        {
            "data": {
                "broadcasted": true,
                "clients": 2
            }
        }
        """
        try:
            # リクエストボディをパース
            event = json.loads(self.request.body.decode("utf-8"))
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in request body: {e}")
            self.write_error_response("VALIDATION_ERROR", "Invalid JSON", 400)
            return

        # リクエストボディが JSON オブジェクトであることを確認
        if not isinstance(event, dict):
            self.write_error_response("VALIDATION_ERROR", "Request body must be a JSON object", 400)
            return

        # type フィールドの検証
        event_type = event.get("type")
        if not isinstance(event_type, str) or event_type not in ALLOWED_EVENT_TYPES:
            self.write_error_response(
                "VALIDATION_ERROR",
                f"Invalid event type: {event_type}",
                400,
            )
            return

        # 全イベント共通: notebook_path の検証
        notebook_path = event.get("notebook_path")
        if not isinstance(notebook_path, str):
            self.write_error_response(
                "VALIDATION_ERROR",
                "notebook_path must be a string",
                400,
            )
            return

        # notebook_changed 固有フィールドの検証
        if event_type == "notebook_changed":
            seq = event.get("seq")
            if not isinstance(seq, int) or isinstance(seq, bool):
                self.write_error_response(
                    "VALIDATION_ERROR",
                    "seq must be an integer",
                    400,
                )
                return

        try:
            # 接続中のすべてのWebSocketクライアントにブロードキャスト
            broadcasted_count = broadcast_event(event)

            logger.info(f"Broadcasted event to {broadcasted_count} clients: {event_type}")

            # レスポンス
            self.finish(json.dumps({"data": {"broadcasted": True, "clients": broadcasted_count}}))

        except Exception as e:
            logger.error(f"Error in AiEventsPostHandler: {e}")
            self.write_error_response("INTERNAL_ERROR", "Internal server error", 500)
