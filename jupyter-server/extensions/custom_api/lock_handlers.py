"""ノートブックロックの取得/解放/延長 REST API ハンドラー（タスク 21.2）

- POST   /api/ai/locks  : ロック取得（acquire）。競合時は 423 NOTEBOOK_LOCKED
- DELETE /api/ai/locks  : ロック解放（release）
- PUT    /api/ai/locks  : ロック延長（heartbeat / renew）

ロック取得・解放・失効時に接続中の WebSocket クライアントへ lock_acquired /
lock_released イベントを配信し、ブラウザ（jupyterlab-ai-sync）が readOnly 表示に
追従できるようにする。
"""

import logging

from tornado import web

from . import notebook_locks
from .base import BaseCustomHandler

log = logging.getLogger(__name__)


def _broadcast(event: dict) -> None:
    """WebSocket クライアントへイベントを配信する（遅延インポートで循環・モック依存を回避）。"""
    from .ai_events import broadcast_event

    broadcast_event(event)


def _validate_lock_path(path) -> tuple[str | None, str | None]:
    """ロック対象パスのバリデーションと正規化。

    Returns:
        (normalized_path, error_message)。正常時は (正規化パス, None)、
        エラー時は (None, メッセージ)。

    先頭スラッシュを除去して正規化する（validate_path / contents_manager.save に
    渡るパスと同一形にし、ロックキーを統一する）。これにより "/ws/x.ipynb" と
    "ws/x.ipynb" が同一のロックキーになる（バグ 2: ロックバイパス防止）。
    """
    if not path or not isinstance(path, str):
        return None, "notebook_path is required"
    if len(path) > 255:
        return None, "notebook_path exceeds maximum length (255 characters)"
    if ".." in path or "\0" in path:
        return None, "notebook_path contains invalid characters"
    if not path.endswith(".ipynb"):
        return None, "notebook_path must be a notebook (.ipynb)"
    # パスを正規化（save 検査パスと同一キーにする）
    normalized = notebook_locks.normalize_notebook_path(path)
    if not normalized:
        return None, "notebook_path is required"
    return normalized, None


def _validate_ttl(ttl) -> tuple[int | None, str | None]:
    """ttl のバリデーション。

    Returns:
        (ttl, error_message)。正常時は (int(ttl), None)。

    ttl < 1 を拒否する（バグ 3: ttl=0/負値だと取得直後に失効し無防備になるため）。
    上限クランプは notebook_locks.acquire/renew 側（_clamp_ttl）に委ねる。
    """
    if not isinstance(ttl, (int, float)) or isinstance(ttl, bool):
        return None, "ttl must be a number"
    if ttl < 1:
        return None, "ttl must be at least 1 second"
    return int(ttl), None


class NotebookLocksHandler(BaseCustomHandler):
    """POST/DELETE/PUT /api/ai/locks"""

    @web.authenticated
    async def post(self):
        """ロックを取得する。競合時は 423 を返す。"""
        body = self.get_json_body()
        raw_ttl = body.get("ttl", notebook_locks.DEFAULT_TTL)

        path, path_error = _validate_lock_path(body.get("notebook_path"))
        if path_error:
            self.write_error_response("VALIDATION_ERROR", path_error, 400)
            return

        ttl, ttl_error = _validate_ttl(raw_ttl)
        if ttl_error:
            self.write_error_response("VALIDATION_ERROR", ttl_error, 400)
            return

        result = notebook_locks.acquire(path, ttl=ttl)
        if result is None:
            self.write_error_response("NOTEBOOK_LOCKED", f"Notebook is locked: {path}", 423)
            return

        _broadcast({"type": "lock_acquired", "notebook_path": path})
        self.write_success({"lock_token": result["token"], "expires_at": result["expires_at"]})

    @web.authenticated
    async def delete(self):
        """ロックを解放する。所有者トークンが必要。"""
        body = self.get_json_body()
        token = body.get("lock_token")

        path, path_error = _validate_lock_path(body.get("notebook_path"))
        if path_error:
            self.write_error_response("VALIDATION_ERROR", path_error, 400)
            return
        if not token or not isinstance(token, str):
            self.write_error_response("VALIDATION_ERROR", "lock_token is required", 400)
            return

        released = notebook_locks.release(path, token)
        if released:
            _broadcast({"type": "lock_released", "notebook_path": path})
        self.write_success({"released": released})

    @web.authenticated
    async def put(self):
        """ロックの TTL を延長する（heartbeat）。所有者トークンが必要。"""
        body = self.get_json_body()
        token = body.get("lock_token")
        raw_ttl = body.get("ttl", notebook_locks.DEFAULT_TTL)

        path, path_error = _validate_lock_path(body.get("notebook_path"))
        if path_error:
            self.write_error_response("VALIDATION_ERROR", path_error, 400)
            return
        if not token or not isinstance(token, str):
            self.write_error_response("VALIDATION_ERROR", "lock_token is required", 400)
            return
        ttl, ttl_error = _validate_ttl(raw_ttl)
        if ttl_error:
            self.write_error_response("VALIDATION_ERROR", ttl_error, 400)
            return

        result = notebook_locks.renew(path, token, ttl=ttl)
        if result is None:
            self.write_error_response("NOTEBOOK_LOCKED", f"Lock not held for: {path}", 423)
            return

        self.write_success({"lock_token": result["token"], "expires_at": result["expires_at"]})
