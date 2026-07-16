"""
カスタムハンドラー基底クラスと共通ユーティリティ

循環 import を防ぐため、BaseCustomHandler と共通関数をこのファイルで定義する。
"""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jupyter_server.base.handlers import APIHandler

_data_env = os.environ.get("DATA_ENV", "sample")
WORKSPACE_ROOT_DIR = os.environ.get("WORKSPACE_ROOT_DIR", f"/home/jovyan/work/workspaces/{_data_env}")

JUPYTER_ROOT_DIR = "/home/jovyan/work"
WORKSPACE_PATH_PREFIX = os.path.relpath(WORKSPACE_ROOT_DIR, JUPYTER_ROOT_DIR)
# DATA_ENV=sample の場合: "workspaces/sample"


def workspace_contents_path(workspace_id: str) -> str:
    """workspace_id から Contents API 用の相対パスを返す"""
    return f"{WORKSPACE_PATH_PREFIX}/{workspace_id}"


def utc_now_iso() -> str:
    """現在時刻をUTC ISO 8601形式（末尾Z）で返す"""
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def make_response(data: Any) -> dict:
    """成功レスポンスを生成"""
    return {"data": data}


def make_error(code: str, message: str) -> dict:
    """エラーレスポンスを生成"""
    return {"error": {"code": code, "message": message}}


def validate_workspace_id(workspace_id) -> str | None:
    """
    workspace_id のバリデーション。

    Returns:
        None: 正常
        str: エラーメッセージ
    """
    if not workspace_id or not isinstance(workspace_id, str):
        return "workspace_id is required"
    if len(workspace_id) > 50:
        return "workspace_id exceeds maximum length (50 characters)"
    if ".." in workspace_id or "/" in workspace_id or "\\" in workspace_id:
        return "workspace_id contains invalid characters"
    return None


def resolve_workspace_dir(workspace_id: str) -> Path:
    """
    workspace_id からワークスペースディレクトリの Path を解決する。

    パストラバーサル対策として WORKSPACE_ROOT_DIR 配下であることを検証する。

    Raises:
        ValueError: パストラバーサルが検出された場合
    """
    root = Path(WORKSPACE_ROOT_DIR).resolve()
    workspace_dir = (root / workspace_id).resolve()
    try:
        workspace_dir.relative_to(root)
    except ValueError:
        raise ValueError("Invalid workspace_id") from None
    return workspace_dir


def validate_kernel_name(kernel_name) -> str | None:
    """
    kernel_name のバリデーション。

    Returns:
        None: 正常
        str: エラーメッセージ
    """
    if not isinstance(kernel_name, str) or len(kernel_name) > 50:
        return "kernel_name must be a string of at most 50 characters"
    if not re.match(r"^[a-zA-Z0-9_-]+$", kernel_name):
        return "kernel_name contains invalid characters"
    return None


def validate_timeout(timeout, max_timeout: int = 300) -> tuple[int | None, str | None]:
    """
    timeout のバリデーション。

    Returns:
        (int値, None): 正常
        (None, エラーメッセージ): エラー
    """
    if not isinstance(timeout, (int, float)):
        return None, "timeout must be a number"
    if timeout <= 0:
        return None, "timeout must be positive"
    if timeout > max_timeout:
        return None, f"timeout exceeds maximum ({max_timeout} seconds)"
    return int(timeout), None


class BaseCustomHandler(APIHandler):
    """カスタムハンドラーの基底クラス"""

    def write_json(self, data: dict, status_code: int = 200):
        """JSONレスポンスを書き込む"""
        self.set_status(status_code)
        self.set_header("Content-Type", "application/json")
        self.write(json.dumps(data, ensure_ascii=False, default=str))

    def write_success(self, data: Any):
        """成功レスポンスを書き込む"""
        self.write_json(make_response(data))

    def write_error_response(self, code: str, message: str, status_code: int = 400):
        """エラーレスポンスを書き込む"""
        self.write_json(make_error(code, message), status_code)

    def get_json_body(self) -> dict:
        """リクエストボディをJSONとしてパース"""
        try:
            return json.loads(self.request.body.decode("utf-8")) if self.request.body else {}
        except json.JSONDecodeError:
            return {}

    def check_kernel_exists(self, kernel_id: str) -> bool:
        """カーネルの存在確認"""
        if kernel_id not in self.kernel_manager:
            self.write_error_response("KERNEL_NOT_FOUND", f"Kernel not found: {kernel_id}", 404)
            return False
        return True

    @property
    def kernel_manager(self):
        """カーネルマネージャーを取得"""
        return self.settings["kernel_manager"]

    @property
    def contents_manager(self):
        """コンテンツマネージャーを取得"""
        return self.settings["contents_manager"]


# =============================================================================
# 共有ヘルパー関数
# =============================================================================


def validate_path(user_input: str, base_dir: str = JUPYTER_ROOT_DIR) -> str:
    """
    パストラバーサル攻撃を防ぐためのパス検証

    Args:
        user_input: ユーザーからの入力パス
        base_dir: ベースディレクトリ

    Returns:
        検証済みの相対パス

    Raises:
        ValueError: 不正なパスの場合
    """
    if not user_input:
        return ""

    # 先頭の / を削除（相対パスとして扱う）
    clean_path = user_input.lstrip("/")

    # 絶対パス化して検証
    base = Path(base_dir).resolve()
    target = (base / clean_path).resolve()

    # ベースディレクトリ配下にあることを確認
    try:
        target.relative_to(base)
    except ValueError:
        raise ValueError(f"不正なパスです: {user_input}") from None

    return clean_path


def _apply_lock_token(handler) -> None:
    """X-Lock-Token ヘッダーをロックトークン ContextVar に設定する。

    contents_manager.save のラップ（_wrap_contents_save）が、この ContextVar と
    ロックストアのトークンを照合してロック中ノートブックへの書き込み可否を判定する。
    書き込み系ハンドラーの冒頭で呼ぶこと。request が存在しない（テストのモック等）場合は
    トークンを None に設定する。
    """
    from . import notebook_locks

    request = getattr(handler, "request", None)
    headers = getattr(request, "headers", None)
    token = headers.get("X-Lock-Token") if headers is not None else None
    notebook_locks.lock_token_ctx.set(token)
