"""
カスタム REST API ハンドラー

api-contracts.md に定義された仕様に従った API を提供する。
"""

from __future__ import annotations

import logging
import re
import time
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd

from tornado import web

from .ai_events import AiEventsPostHandler, AiEventsWebSocketHandler
from .base import (
    JUPYTER_ROOT_DIR,
    WORKSPACE_PATH_PREFIX,
    WORKSPACE_ROOT_DIR,
    BaseCustomHandler,
    resolve_workspace_dir,
    validate_kernel_name,
    validate_timeout,
    workspace_contents_path,
)
from .code_validator import validate_code
from .kernel_executor import KernelExecutor
from .session_handlers import CustomSessionsHandler, get_kernel_workspace, unregister_kernel
from .sql_handlers import SqlExecuteHandler, SqlExportHandler
from .workspace_handlers import WorkspaceHandler, WorkspacesHandler, WorkspaceSummarizeHandler

log = logging.getLogger(__name__)


async def _find_available_path(contents_manager, target_path: str) -> str:
    """
    既存ファイルとの重複を避けるため、自動連番でパスを探索する。

    target_path が既に存在する場合:
      name.ipynb → name_2.ipynb → name_3.ipynb → ...
    """
    if not await contents_manager.file_exists(target_path):
        return target_path

    # ベース名と拡張子に分割
    filename = target_path.rsplit("/", 1)[-1] if "/" in target_path else target_path
    if "." in filename:
        base, ext = target_path.rsplit(".", 1)
        ext = "." + ext
    else:
        base = target_path
        ext = ""

    counter = 2
    while counter <= 100:
        new_path = f"{base}_{counter}{ext}"
        if not await contents_manager.file_exists(new_path):
            return new_path
        counter += 1

    raise ValueError(f"Could not find available path for: {target_path}")


async def _create_content(contents_manager, target_path: str, content_type: str = "notebook"):
    """ノートブックまたはファイルを作成する共通ヘルパー"""
    if content_type == "notebook":
        return await contents_manager.new(
            path=target_path,
            model={
                "type": "notebook",
                "content": {
                    "cells": [],
                    "metadata": {},
                    "nbformat": 4,
                    "nbformat_minor": 5,
                },
            },
        )
    return await contents_manager.new(path=target_path)


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


# =============================================================================
# ヘルスチェック
# =============================================================================


class HealthHandler(BaseCustomHandler):
    """GET /health"""

    @web.authenticated
    def get(self):
        kernels = list(self.kernel_manager.list_kernel_ids())
        self.write_json(
            {
                "status": "healthy",
                "version": "1.0.0",
                "kernels_active": len(kernels),
            }
        )


# =============================================================================
# カーネル管理
# =============================================================================


class KernelsHandler(BaseCustomHandler):
    """GET/POST /api/kernels"""

    @web.authenticated
    async def get(self):
        """カーネル一覧を取得"""
        kernel_ids = self.kernel_manager.list_kernel_ids()
        kernels = []
        for kernel_id in kernel_ids:
            kernel = self.kernel_manager.get_kernel(kernel_id)
            kernels.append(
                {
                    "id": kernel_id,
                    "name": kernel.kernel_name,
                    "status": kernel.execution_state or "unknown",
                    "started_at": kernel.last_activity.isoformat() if kernel.last_activity else None,
                }
            )
        self.write_success({"kernels": kernels})

    @web.authenticated
    async def post(self):
        """カーネルを起動"""
        body = self.get_json_body()
        kernel_name = body.get("name", "python3")

        kn_error = validate_kernel_name(kernel_name)
        if kn_error:
            self.write_error_response("VALIDATION_ERROR", kn_error, 400)
            return

        try:
            kernel_id = await self.kernel_manager.start_kernel(kernel_name=kernel_name)
            kernel = self.kernel_manager.get_kernel(kernel_id)
            self.write_success(
                {
                    "id": kernel_id,
                    "name": kernel.kernel_name,
                    "status": "starting",
                    "started_at": datetime.utcnow().isoformat() + "Z",
                }
            )
        except Exception as e:
            log.error("Failed to start kernel: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to start kernel", 500)


class KernelHandler(BaseCustomHandler):
    """GET/DELETE /api/kernels/{kernel_id}"""

    @web.authenticated
    async def get(self, kernel_id: str):
        """カーネルの状態を取得"""
        if not self.check_kernel_exists(kernel_id):
            return

        kernel = self.kernel_manager.get_kernel(kernel_id)
        executor = KernelExecutor(kernel_id, self.kernel_manager)
        execution_count = await executor.get_execution_count()

        self.write_success(
            {
                "id": kernel_id,
                "name": kernel.kernel_name,
                "status": kernel.execution_state or "unknown",
                "execution_count": execution_count,
                "started_at": kernel.last_activity.isoformat() if kernel.last_activity else None,
            }
        )

    @web.authenticated
    async def delete(self, kernel_id: str):
        """カーネルを停止"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.shutdown_kernel(kernel_id)
        unregister_kernel(kernel_id)
        self.write_success(
            {
                "id": kernel_id,
                "status": "deleted",
            }
        )


class KernelInterruptHandler(BaseCustomHandler):
    """POST /api/kernels/{kernel_id}/interrupt"""

    @web.authenticated
    async def post(self, kernel_id: str):
        """実行中のコードを中断"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.interrupt_kernel(kernel_id)
        kernel = self.kernel_manager.get_kernel(kernel_id)
        self.write_success(
            {
                "id": kernel_id,
                "status": kernel.execution_state or "idle",
            }
        )


class KernelRestartHandler(BaseCustomHandler):
    """POST /api/kernels/{kernel_id}/restart"""

    @web.authenticated
    async def post(self, kernel_id: str):
        """カーネルを再起動"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.restart_kernel(kernel_id)
        self.write_success(
            {
                "id": kernel_id,
                "status": "starting",
            }
        )


# =============================================================================
# コード実行
# =============================================================================


async def _resolve_workspace_for_kernel(handler: BaseCustomHandler, kernel_id: str) -> tuple[Path | None, str | None]:
    """
    kernel_id からワークスペースの output_dir と workspace_rel_path を解決する。

    1. session_manager のセッション一覧から kernel_id に対応するセッションを検索し、
       パス (workspaces/{workspace_id}/...) から workspace_id を逆引きする。
    2. _kernel_workspace_map（セッション作成時に登録されたマッピング）から検索する。
    3. セッションが見つからない場合、カーネルの cwd からワークスペースを推定する。

    Returns:
        (output_dir, workspace_rel_path) or (None, None)
    """
    workspace_id = None

    # 1. session_manager から検索
    session_manager = handler.settings.get("session_manager")
    if session_manager:
        try:
            sessions = await session_manager.list_sessions()
            for session in sessions:
                if session.get("kernel", {}).get("id") == kernel_id:
                    path = session.get("path", "")
                    match = re.match(rf"^{re.escape(WORKSPACE_PATH_PREFIX)}/([^/]+)/", path)
                    if match:
                        workspace_id = match.group(1)
                    break
        except Exception:
            log.debug("Failed to list sessions for workspace resolution", exc_info=True)

    # 2. kernel_id → workspace_id マッピングから検索
    if workspace_id is None:
        workspace_id = get_kernel_workspace(kernel_id)

    # 3. カーネルの cwd からフォールバック
    if workspace_id is None:
        try:
            kernel = handler.kernel_manager.get_kernel(kernel_id)
            cwd = getattr(kernel, "cwd", None)
            if cwd is None:
                provisioner = getattr(kernel, "provisioner", None)
                if provisioner:
                    cwd = getattr(provisioner, "cwd", None)
            if cwd:
                workspace_root = Path(WORKSPACE_ROOT_DIR).resolve()
                rel = Path(cwd).resolve().relative_to(workspace_root)
                if rel.parts:
                    workspace_id = str(rel.parts[0])
        except Exception:
            log.debug("Failed to resolve workspace from kernel cwd", exc_info=True)

    if workspace_id is None:
        return None, None

    try:
        workspace_dir = resolve_workspace_dir(workspace_id)
        output_dir = workspace_dir / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir, workspace_contents_path(workspace_id)
    except (ValueError, OSError):
        return None, None


class KernelExecuteHandler(BaseCustomHandler):
    """POST /api/kernels/{kernel_id}/execute"""

    @web.authenticated
    async def post(self, kernel_id: str):
        """コードを実行"""
        if not self.check_kernel_exists(kernel_id):
            return

        body = self.get_json_body()
        code = body.get("code")
        timeout = body.get("timeout", 30)

        # code パラメータは必須だが、空文字列は許可（空コードは何もしないだけ）
        if code is None:
            self.write_error_response("VALIDATION_ERROR", "code is required", 400)
            return

        # 空文字列の場合はそのまま処理（何もしない）
        if not isinstance(code, str):
            self.write_error_response("VALIDATION_ERROR", "code must be a string", 400)
            return

        # 長さチェック（DoS対策）
        if len(code) > 1000000:
            self.write_error_response("VALIDATION_ERROR", "code exceeds maximum length (1000000 characters)", 400)
            return

        # NULLバイト攻撃対策
        if "\0" in code:
            self.write_error_response("VALIDATION_ERROR", "code contains invalid characters", 400)
            return

        # AST解析によるコード検証（危険なモジュール・関数の使用をブロック）
        validation = validate_code(code)
        if not validation.valid:
            self.write_error_response(
                "CODE_NOT_ALLOWED",
                validation.error,
                400,
            )
            return

        # timeout パラメータの検証
        validated_timeout, timeout_error = validate_timeout(timeout)
        if timeout_error:
            self.write_error_response("VALIDATION_ERROR", timeout_error, 400)
            return
        timeout = validated_timeout

        # ワークスペース解決（画像ファイル保存先）
        output_dir, workspace_rel_path = await _resolve_workspace_for_kernel(self, kernel_id)

        executor = KernelExecutor(kernel_id, self.kernel_manager)
        start_time = time.time()

        try:
            result = await executor.execute(
                code,
                timeout=timeout,
                output_dir=output_dir,
                workspace_rel_path=workspace_rel_path,
            )
            execution_time_ms = int((time.time() - start_time) * 1000)
            result["execution_time_ms"] = execution_time_ms
            self.write_success(result)
        except TimeoutError:
            execution_time_ms = int((time.time() - start_time) * 1000)
            self.write_success(
                {
                    "success": False,
                    "execution_count": 0,
                    "error": {
                        "type": "TimeoutError",
                        "message": f"Execution timed out after {timeout} seconds",
                        "traceback": [],
                    },
                    "execution_time_ms": execution_time_ms,
                }
            )
        except Exception as e:
            execution_time_ms = int((time.time() - start_time) * 1000)
            log.error("Execution error in kernel %s: %s", kernel_id, e, exc_info=True)
            self.write_success(
                {
                    "success": False,
                    "execution_count": 0,
                    "error": {
                        "type": type(e).__name__,
                        "message": str(e),
                        "traceback": [],
                    },
                    "execution_time_ms": execution_time_ms,
                }
            )


# =============================================================================
# 変数管理
# =============================================================================


class KernelVariablesHandler(BaseCustomHandler):
    """GET /api/kernels/{kernel_id}/variables"""

    @web.authenticated
    async def get(self, kernel_id: str):
        """変数一覧を取得"""
        if not self.check_kernel_exists(kernel_id):
            return

        executor = KernelExecutor(kernel_id, self.kernel_manager)
        try:
            variables = await executor.get_variables()
            self.write_success({"variables": variables})
        except Exception as e:
            log.error("Failed to get variables: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to get variables", 500)


class KernelVariableHandler(BaseCustomHandler):
    """GET /api/kernels/{kernel_id}/variables/{name}"""

    @web.authenticated
    async def get(self, kernel_id: str, name: str):
        """変数の詳細を取得"""
        if not self.check_kernel_exists(kernel_id):
            return

        executor = KernelExecutor(kernel_id, self.kernel_manager)
        try:
            variable = await executor.get_variable(name)
            if variable is None:
                self.write_error_response("NOT_FOUND", f"Variable not found: {name}", 404)
                return
            self.write_success(variable)
        except Exception as e:
            log.error("Failed to get variable '%s': %s", name, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to get variable", 500)


# =============================================================================
# ファイル・ノートブック管理
# =============================================================================


class ContentsListHandler(BaseCustomHandler):
    """GET/POST /api/custom/contents"""

    @web.authenticated
    async def get(self):
        """ファイル一覧を取得"""
        path = self.get_argument("path", "/")

        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=True)
            contents = []
            if model["type"] == "directory":
                for item in model.get("content", []):
                    contents.append(
                        {
                            "name": item["name"],
                            "type": item["type"],
                            "size": item.get("size"),
                            "modified_at": item.get("last_modified"),
                        }
                    )
            self.write_success(
                {
                    "path": "/" + path if path else "/",
                    "contents": contents,
                }
            )
        except Exception as e:
            log.error("Failed to list contents: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to list contents", 500)

    @web.authenticated
    async def post(self):
        """ノートブックまたはファイルを作成"""
        body = self.get_json_body()
        content_type = body.get("type", "notebook")
        target_path = body.get("path", "")

        try:
            # パストラバーサル対策
            target_path = validate_path(target_path)
            # 既存ファイルとの重複を避ける自動連番
            target_path = await _find_available_path(self.contents_manager, target_path)
            model = await _create_content(self.contents_manager, target_path, content_type)

            self.write_success(
                {
                    "path": "/" + model["path"],
                    "type": model["type"],
                    "created_at": model.get("created") or model.get("last_modified"),
                }
            )
        except Exception as e:
            log.error("Failed to create content: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to create content", 500)


class ContentsHandler(BaseCustomHandler):
    """GET/PUT/DELETE /api/custom/contents/{path}"""

    @web.authenticated
    async def get(self, path: str):
        """ファイルまたはノートブックの内容を取得"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=True)
            if model["type"] == "notebook":
                self.write_success(
                    {
                        "path": "/" + path,
                        "type": "notebook",
                        "content": model["content"],
                        "modified_at": model.get("last_modified"),
                    }
                )
            else:
                self.write_success(
                    {
                        "path": "/" + path,
                        "type": model["type"],
                        "content": model.get("content"),
                        "modified_at": model.get("last_modified"),
                    }
                )
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to get content '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to get content", 500)

    @web.authenticated
    async def post(self, path: str = ""):
        """ノートブックまたはファイルを作成"""
        body = self.get_json_body()
        content_type = body.get("type", "notebook")
        target_path = body.get("path", path)

        try:
            # パストラバーサル対策
            target_path = validate_path(target_path)
            # 既存ファイルとの重複を避ける自動連番
            target_path = await _find_available_path(self.contents_manager, target_path)
            model = await _create_content(self.contents_manager, target_path, content_type)

            self.write_success(
                {
                    "path": "/" + model["path"],
                    "type": model["type"],
                    "created_at": model.get("created") or model.get("last_modified"),
                }
            )
        except Exception as e:
            log.error("Failed to create content: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to create content", 500)

    @web.authenticated
    async def put(self, path: str):
        """ファイルまたはノートブックを更新"""
        body = self.get_json_body()
        content = body.get("content")

        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=False)
            model["content"] = content
            await self.contents_manager.save(model, path)
            self.write_success({"path": "/" + path, "status": "updated"})
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to update content '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to update content", 500)

    @web.authenticated
    async def delete(self, path: str):
        """ファイルまたはノートブックを削除"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
            await self.contents_manager.delete(path)
            self.write_success({"path": "/" + path, "status": "deleted"})
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to delete content '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to delete content", 500)


class ContentsCellsHandler(BaseCustomHandler):
    """GET/PATCH /api/custom/contents/{path}/cells"""

    @web.authenticated
    async def get(self, path: str):
        """ノートブックのセル一覧を取得"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
            if not path.endswith(".ipynb"):
                self.write_error_response("VALIDATION_ERROR", "Not a notebook: path must end with .ipynb", 400)
                return
            model = await self.contents_manager.get(path, content=True)
            if model["type"] != "notebook":
                self.write_error_response("VALIDATION_ERROR", "Not a notebook", 400)
                return

            cells = model["content"].get("cells", [])
            cell_list = []
            for i, cell in enumerate(cells):
                cell_info = {
                    "cell_index": i,
                    "cell_type": cell.get("cell_type", "code"),
                    "source": cell.get("source", ""),
                }
                if cell.get("cell_type") == "code":
                    cell_info["outputs"] = cell.get("outputs", [])
                    cell_info["execution_count"] = cell.get("execution_count")
                cell_list.append(cell_info)

            self.write_success(
                {
                    "path": "/" + path,
                    "total_cells": len(cell_list),
                    "cells": cell_list,
                }
            )
        except FileNotFoundError:
            self.write_error_response("NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to get cells '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to get cells", 500)

    @web.authenticated
    async def patch(self, path: str):
        """セルを追加・更新・削除・並び替え"""
        body = self.get_json_body()
        action = body.get("action")
        cell = body.get("cell")
        index = body.get("index")
        to_index = body.get("to_index")

        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=True)
            if model["type"] != "notebook":
                self.write_error_response("VALIDATION_ERROR", "Not a notebook", 400)
                return

            cells = model["content"].get("cells", [])

            if action in ("add", "update") and cell is None:
                self.write_error_response("VALIDATION_ERROR", "cell is required", 400)
                return

            if action == "add":
                new_cell = {
                    "cell_type": cell.get("cell_type", "code"),
                    "source": cell.get("source", ""),
                    "metadata": {},
                }
                if new_cell["cell_type"] == "code":
                    new_cell["outputs"] = []
                    new_cell["execution_count"] = None

                if index is not None and 0 <= index <= len(cells):
                    cells.insert(index, new_cell)
                else:
                    cells.append(new_cell)

            elif action == "update":
                if index is None or index < 0 or index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {index}", 400)
                    return
                if cell.get("source") is not None:
                    cells[index]["source"] = cell["source"]
                if cell.get("cell_type") is not None:
                    cells[index]["cell_type"] = cell["cell_type"]
                if cell.get("outputs") is not None:
                    cells[index]["outputs"] = cell["outputs"]
                if cell.get("execution_count") is not None:
                    cells[index]["execution_count"] = cell["execution_count"]

            elif action == "delete":
                if index is None or index < 0 or index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {index}", 400)
                    return
                cells.pop(index)

            elif action == "reorder":
                if index is None or index < 0 or index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {index}", 400)
                    return
                if not isinstance(to_index, int) or to_index < 0 or to_index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid to_index: {to_index}", 400)
                    return
                cell_to_move = cells.pop(index)
                # to_index を pop 後のリストに対して挿入
                insert_index = min(to_index, len(cells))
                cells.insert(insert_index, cell_to_move)

            else:
                self.write_error_response("VALIDATION_ERROR", f"Unknown action: {action}", 400)
                return

            model["content"]["cells"] = cells
            await self.contents_manager.save(model, path)
            self.write_success({"path": "/" + path, "status": "updated"})

        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to update cells '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to update cells", 500)


# =============================================================================
# データプレビュー
# =============================================================================

_MAX_HEAD_ROWS = 50
_DEFAULT_HEAD_ROWS = 5


def _serialize_value(val):
    """pandas/numpy 値を JSON 直列化可能な Python 型に変換する"""
    import math

    import numpy as np

    if val is None:
        return None
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    if isinstance(val, np.integer):
        return int(val)
    if isinstance(val, np.floating):
        v = float(val)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(val, np.bool_):
        return bool(val)
    # datetime 系は str() で ISO 8601 風に変換
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return val


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    """DataFrame を JSON 直列化可能なレコードのリストに変換する"""
    rows = []
    for _, row in df.iterrows():
        rows.append({col: _serialize_value(row[col]) for col in df.columns})
    return rows


class ContentsPreviewHandler(BaseCustomHandler):
    """GET /api/custom/contents/{path}/preview"""

    @web.authenticated
    def get(self, path: str):
        """CSV/Parquetファイルの先頭行・カラム情報・行数を返す"""
        import pandas as pd
        import pyarrow.parquet as pq

        try:
            path = validate_path(path)
        except ValueError as e:
            self.write_error_response("VALIDATION_ERROR", str(e), 400)
            return

        # head_rows クエリパラメータ
        head_rows_str = self.get_argument("head_rows", str(_DEFAULT_HEAD_ROWS))
        try:
            head_rows = int(head_rows_str)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", "head_rows must be an integer", 400)
            return

        if head_rows < 0:
            self.write_error_response("VALIDATION_ERROR", "head_rows must be >= 0", 400)
            return
        if head_rows > _MAX_HEAD_ROWS:
            self.write_error_response("VALIDATION_ERROR", f"head_rows must be <= {_MAX_HEAD_ROWS}", 400)
            return

        # 拡張子チェック
        if path.endswith(".csv"):
            file_format = "csv"
        elif path.endswith(".parquet"):
            file_format = "parquet"
        else:
            self.write_error_response("UNSUPPORTED_FORMAT", "Only .csv and .parquet files are supported", 400)
            return

        # 絶対パスを解決
        abs_path = Path(JUPYTER_ROOT_DIR) / path

        if not abs_path.exists():
            self.write_error_response("NOT_FOUND", f"File not found: {path}", 404)
            return

        try:
            file_size_bytes = abs_path.stat().st_size

            if file_format == "csv":
                head_df = pd.read_csv(abs_path, nrows=head_rows)
                # ヘッダー行を除いた全行数をカウント
                with open(abs_path, encoding="utf-8") as f:
                    row_count = sum(1 for _ in f) - 1
                columns = [{"name": col, "dtype": str(head_df[col].dtype)} for col in head_df.columns]
                head_records = _df_to_records(head_df)

            else:  # parquet
                pf = pq.ParquetFile(abs_path)
                row_count = pf.metadata.num_rows
                head_df = pf.read_row_group(0).to_pandas().head(head_rows)
                columns = [{"name": col, "dtype": str(head_df[col].dtype)} for col in head_df.columns]
                head_records = _df_to_records(head_df)

            self.write_success(
                {
                    "path": "/" + path,
                    "format": file_format,
                    "columns": columns,
                    "row_count": row_count,
                    "head": head_records,
                    "file_size_bytes": file_size_bytes,
                }
            )
        except Exception as e:
            log.error("Failed to preview file '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to preview file", 500)


# =============================================================================
# セル実行ヘルパー
# =============================================================================


async def _load_notebook(handler: BaseCustomHandler, path: str):
    """ノートブックを読み込み、(model, cells) を返す。エラー時は None を返す（レスポンスはハンドラーが送信済み）。"""
    try:
        model = await handler.contents_manager.get(path, content=True)
    except FileNotFoundError:
        handler.write_error_response("NOT_FOUND", f"Not found: {path}", 404)
        return None
    except Exception as e:
        log.error("Failed to get notebook '%s': %s", path, e, exc_info=True)
        handler.write_error_response("INTERNAL_ERROR", "Failed to get notebook", 500)
        return None

    if model["type"] != "notebook":
        handler.write_error_response("VALIDATION_ERROR", "Not a notebook", 400)
        return None

    cells = model["content"].get("cells", [])
    return model, cells


def _result_to_nb_outputs(result: dict) -> list:
    """KernelExecutor の実行結果を Jupyter Notebook の outputs 形式に変換する。"""
    nb_outputs = []
    for output in result.get("outputs", []):
        nb_outputs.append(
            {
                "output_type": "stream",
                "name": output.get("type", "stdout"),
                "text": output.get("text", ""),
            }
        )
    if result.get("result") is not None:
        nb_outputs.append(
            {
                "output_type": "execute_result",
                "execution_count": result.get("execution_count", 0),
                "data": {"text/plain": str(result["result"])},
                "metadata": {},
            }
        )
    if result.get("error"):
        nb_outputs.append(
            {
                "output_type": "error",
                "ename": result["error"].get("type", "Error"),
                "evalue": result["error"].get("message", ""),
                "traceback": result["error"].get("traceback", []),
            }
        )
    return nb_outputs


# =============================================================================
# セル再実行
# =============================================================================


class ContentsCellExecuteHandler(BaseCustomHandler):
    """POST /api/custom/contents/{path}/cells/{index}/execute"""

    @web.authenticated
    async def post(self, path: str, index: str):
        """指定セルを再実行する"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
        except ValueError as e:
            self.write_error_response("VALIDATION_ERROR", str(e), 400)
            return

        if not path.endswith(".ipynb"):
            self.write_error_response("VALIDATION_ERROR", "Not a notebook: path must end with .ipynb", 400)
            return

        # セルインデックスの解析
        try:
            cell_index = int(index)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", f"Invalid cell index: {index}", 400)
            return

        # リクエストボディの取得
        body = self.get_json_body() or {}
        kernel_id = body.get("kernel_id")
        timeout = body.get("timeout", 30)

        if not kernel_id:
            self.write_error_response("VALIDATION_ERROR", "kernel_id is required", 400)
            return

        if not self.check_kernel_exists(kernel_id):
            return

        # ノートブックを読み込む
        loaded = await _load_notebook(self, path)
        if loaded is None:
            return
        model, cells = loaded

        # セルインデックスの範囲チェック
        if cell_index < 0 or cell_index >= len(cells):
            self.write_error_response("INVALID_CELL_INDEX", f"Invalid cell index: {cell_index}", 400)
            return

        cell = cells[cell_index]

        # コードセルかどうかの検証
        if cell.get("cell_type") != "code":
            self.write_error_response("VALIDATION_ERROR", "Cell is not a code cell", 400)
            return

        source = cell.get("source", "")

        # AST解析によるコード検証（危険なモジュール・関数の使用をブロック）
        validation = validate_code(source)
        if not validation.valid:
            self.write_error_response(
                "CODE_NOT_ALLOWED",
                validation.error,
                400,
            )
            return

        # timeout の検証
        validated_timeout, timeout_error = validate_timeout(timeout)
        if timeout_error:
            self.write_error_response("VALIDATION_ERROR", timeout_error, 400)
            return

        # ワークスペース解決（画像保存先）
        output_dir, workspace_rel_path = await _resolve_workspace_for_kernel(self, kernel_id)

        executor = KernelExecutor(kernel_id, self.kernel_manager)
        start_time = time.time()

        try:
            result = await executor.execute(
                source,
                timeout=validated_timeout,
                output_dir=output_dir,
                workspace_rel_path=workspace_rel_path,
            )
            execution_time_ms = int((time.time() - start_time) * 1000)
        except TimeoutError:
            execution_time_ms = int((time.time() - start_time) * 1000)
            self.write_success(
                {
                    "success": False,
                    "execution_count": 0,
                    "error": {
                        "type": "TimeoutError",
                        "message": f"Execution timed out after {validated_timeout} seconds",
                        "traceback": [],
                    },
                    "execution_time_ms": execution_time_ms,
                }
            )
            return
        except Exception as e:
            execution_time_ms = int((time.time() - start_time) * 1000)
            log.error("Execution error in kernel %s: %s", kernel_id, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to execute cell", 500)
            return

        nb_outputs = _result_to_nb_outputs(result)

        cells[cell_index]["outputs"] = nb_outputs
        cells[cell_index]["execution_count"] = result.get("execution_count", 0)
        model["content"]["cells"] = cells

        try:
            await self.contents_manager.save(model, path)
        except Exception as e:
            log.error("Failed to save notebook '%s': %s", path, e, exc_info=True)
            # 保存失敗は無視して実行結果を返す

        self.write_success(
            {
                "cell_index": cell_index,
                "source": source,
                "execution_count": result.get("execution_count", 0),
                "outputs": nb_outputs,
                "execution_time_ms": execution_time_ms,
            }
        )


class ContentsCellExecuteBatchHandler(BaseCustomHandler):
    """POST /api/custom/contents/{path}/cells/execute-batch"""

    @web.authenticated
    async def post(self, path: str):
        """指定範囲のセルを一括実行する"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
        except ValueError as e:
            self.write_error_response("VALIDATION_ERROR", str(e), 400)
            return

        if not path.endswith(".ipynb"):
            self.write_error_response("VALIDATION_ERROR", "Not a notebook: path must end with .ipynb", 400)
            return

        # リクエストボディの取得
        body = self.get_json_body() or {}
        kernel_id = body.get("kernel_id")
        mode = body.get("mode")
        cell_index = body.get("cell_index")
        timeout = body.get("timeout", 30)

        if not kernel_id:
            self.write_error_response("VALIDATION_ERROR", "kernel_id is required", 400)
            return

        if not mode:
            self.write_error_response("VALIDATION_ERROR", "mode is required", 400)
            return

        valid_modes = ("all", "up_to", "from")
        if mode not in valid_modes:
            self.write_error_response(
                "VALIDATION_ERROR",
                f"mode must be one of: {', '.join(valid_modes)}. Got: {mode}",
                400,
            )
            return

        if mode in ("up_to", "from"):
            if cell_index is None:
                self.write_error_response(
                    "VALIDATION_ERROR",
                    f"cell_index is required when mode is '{mode}'",
                    400,
                )
                return
            if not isinstance(cell_index, int):
                self.write_error_response(
                    "VALIDATION_ERROR",
                    f"cell_index must be an integer. Got: {type(cell_index).__name__}",
                    400,
                )
                return

        if not self.check_kernel_exists(kernel_id):
            return

        # ノートブックを読み込む
        loaded = await _load_notebook(self, path)
        if loaded is None:
            return
        model, cells = loaded

        # 実行範囲の決定
        if mode == "all":
            start_idx = 0
            end_idx = len(cells) - 1
        elif mode == "up_to":
            if cell_index < 0 or cell_index >= len(cells):
                self.write_error_response(
                    "VALIDATION_ERROR",
                    f"cell_index {cell_index} is out of range (0-{len(cells) - 1})",
                    400,
                )
                return
            start_idx = 0
            end_idx = cell_index
        else:  # from
            if cell_index < 0 or cell_index >= len(cells):
                self.write_error_response(
                    "VALIDATION_ERROR",
                    f"cell_index {cell_index} is out of range (0-{len(cells) - 1})",
                    400,
                )
                return
            start_idx = cell_index
            end_idx = len(cells) - 1

        # timeout の検証
        validated_timeout, timeout_error = validate_timeout(timeout)
        if timeout_error:
            self.write_error_response("VALIDATION_ERROR", timeout_error, 400)
            return

        # ワークスペース解決（画像保存先）
        output_dir, workspace_rel_path = await _resolve_workspace_for_kernel(self, kernel_id)

        executor = KernelExecutor(kernel_id, self.kernel_manager)

        executed_cells = 0
        success_count = 0
        failed_cell = None

        for i in range(start_idx, end_idx + 1):
            cell = cells[i]
            if cell.get("cell_type") != "code":
                # Markdown セルはスキップ
                continue

            source = cell.get("source", "")

            # AST解析によるコード検証
            validation = validate_code(source)
            if not validation.valid:
                failed_cell = i
                break

            executed_cells += 1

            try:
                result = await executor.execute(
                    source,
                    timeout=validated_timeout,
                    output_dir=output_dir,
                    workspace_rel_path=workspace_rel_path,
                )
            except TimeoutError:
                cells[i]["outputs"] = [
                    {
                        "output_type": "error",
                        "ename": "TimeoutError",
                        "evalue": f"Execution timed out after {validated_timeout} seconds",
                        "traceback": [],
                    }
                ]
                failed_cell = i
                break
            except Exception as e:
                log.error("Execution error in kernel %s at cell %d: %s", kernel_id, i, e, exc_info=True)
                failed_cell = i
                break

            # エラー確認
            if result.get("error"):
                failed_cell = i
                cells[i]["outputs"] = _result_to_nb_outputs(result)
                cells[i]["execution_count"] = result.get("execution_count", 0)
                break

            nb_outputs = _result_to_nb_outputs(result)
            cells[i]["outputs"] = nb_outputs
            cells[i]["execution_count"] = result.get("execution_count", 0)
            success_count += 1

        model["content"]["cells"] = cells

        try:
            await self.contents_manager.save(model, path)
        except Exception as e:
            log.error("Failed to save notebook '%s': %s", path, e, exc_info=True)
            # 保存失敗は無視して実行結果を返す

        self.write_success(
            {
                "executed_cells": executed_cells,
                "success_count": success_count,
                "failed_cell": failed_cell,
            }
        )


# =============================================================================
# ハンドラー登録
# =============================================================================


def get_handlers(base_url: str = ""):
    """ハンドラーのリストを返す"""
    return [
        (f"{base_url}/health", HealthHandler),
        (f"{base_url}/api/kernels", KernelsHandler),
        (f"{base_url}/api/kernels/([^/]+)", KernelHandler),
        (f"{base_url}/api/kernels/([^/]+)/interrupt", KernelInterruptHandler),
        (f"{base_url}/api/kernels/([^/]+)/restart", KernelRestartHandler),
        (f"{base_url}/api/kernels/([^/]+)/execute", KernelExecuteHandler),
        (f"{base_url}/api/kernels/([^/]+)/variables", KernelVariablesHandler),
        (f"{base_url}/api/kernels/([^/]+)/variables/([^/]+)", KernelVariableHandler),
        # /api/contents の代わりに /api/custom/contents を使用（JupyterLab フロントエンドとの競合を回避）
        (f"{base_url}/api/custom/contents", ContentsListHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells/([0-9]+)/execute", ContentsCellExecuteHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells/execute-batch", ContentsCellExecuteBatchHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells", ContentsCellsHandler),
        (f"{base_url}/api/custom/contents/(.*)/preview", ContentsPreviewHandler),
        (f"{base_url}/api/custom/contents/(.*)", ContentsHandler),
        # AI同期イベント
        (f"{base_url}/api/ai/events", AiEventsWebSocketHandler),
        (f"{base_url}/api/ai/events/broadcast", AiEventsPostHandler),
        # ワークスペース管理
        (f"{base_url}/api/workspaces", WorkspacesHandler),
        (f"{base_url}/api/workspaces/([^/]+)/summarize", WorkspaceSummarizeHandler),
        (f"{base_url}/api/workspaces/([^/]+)", WorkspaceHandler),
        # ワークスペース内セッション作成（cwd 対応）
        (f"{base_url}/api/custom/sessions", CustomSessionsHandler),
        # SQL実行
        (f"{base_url}/api/sql/execute", SqlExecuteHandler),
        # SQLエクスポート
        (f"{base_url}/api/sql/export", SqlExportHandler),
    ]
