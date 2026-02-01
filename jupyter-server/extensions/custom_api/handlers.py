"""
カスタム REST API ハンドラー

api-contracts.md に定義された仕様に従った API を提供する。
"""

import json
import time
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from jupyter_server.base.handlers import APIHandler
from tornado import web

from .kernel_executor import KernelExecutor


def make_response(data: Any) -> dict:
    """成功レスポンスを生成"""
    return {"data": data}


def make_error(code: str, message: str) -> dict:
    """エラーレスポンスを生成"""
    return {"error": {"code": code, "message": message}}


def validate_path(user_input: str, base_dir: str = "/home/jovyan/work") -> str:
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
        raise ValueError(f"不正なパスです: {user_input}")

    return clean_path


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
# ヘルスチェック
# =============================================================================


class HealthHandler(BaseCustomHandler):
    """GET /health"""

    @web.authenticated
    def get(self):
        kernels = list(self.kernel_manager.list_kernel_ids())
        self.write_json({
            "status": "healthy",
            "version": "1.0.0",
            "kernels_active": len(kernels),
        })


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
            kernels.append({
                "id": kernel_id,
                "name": kernel.kernel_name,
                "status": kernel.execution_state or "unknown",
                "started_at": kernel.last_activity.isoformat() if kernel.last_activity else None,
            })
        self.write_success({"kernels": kernels})

    @web.authenticated
    async def post(self):
        """カーネルを起動"""
        body = self.get_json_body()
        kernel_name = body.get("name", "python3")

        try:
            kernel_id = await self.kernel_manager.start_kernel(kernel_name=kernel_name)
            kernel = self.kernel_manager.get_kernel(kernel_id)
            self.write_success({
                "id": kernel_id,
                "name": kernel.kernel_name,
                "status": "starting",
                "started_at": datetime.utcnow().isoformat() + "Z",
            })
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


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

        self.write_success({
            "id": kernel_id,
            "name": kernel.kernel_name,
            "status": kernel.execution_state or "unknown",
            "execution_count": execution_count,
            "started_at": kernel.last_activity.isoformat() if kernel.last_activity else None,
        })

    @web.authenticated
    async def delete(self, kernel_id: str):
        """カーネルを停止"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.shutdown_kernel(kernel_id)
        self.write_success({
            "id": kernel_id,
            "status": "deleted",
        })


class KernelInterruptHandler(BaseCustomHandler):
    """POST /api/kernels/{kernel_id}/interrupt"""

    @web.authenticated
    async def post(self, kernel_id: str):
        """実行中のコードを中断"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.interrupt_kernel(kernel_id)
        kernel = self.kernel_manager.get_kernel(kernel_id)
        self.write_success({
            "id": kernel_id,
            "status": kernel.execution_state or "idle",
        })


class KernelRestartHandler(BaseCustomHandler):
    """POST /api/kernels/{kernel_id}/restart"""

    @web.authenticated
    async def post(self, kernel_id: str):
        """カーネルを再起動"""
        if not self.check_kernel_exists(kernel_id):
            return

        await self.kernel_manager.restart_kernel(kernel_id)
        self.write_success({
            "id": kernel_id,
            "status": "starting",
        })


# =============================================================================
# コード実行
# =============================================================================


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

        executor = KernelExecutor(kernel_id, self.kernel_manager)
        start_time = time.time()

        try:
            result = await executor.execute(code, timeout=timeout)
            execution_time_ms = int((time.time() - start_time) * 1000)
            result["execution_time_ms"] = execution_time_ms
            self.write_success(result)
        except TimeoutError:
            execution_time_ms = int((time.time() - start_time) * 1000)
            self.write_success({
                "success": False,
                "execution_count": 0,
                "error": {
                    "type": "TimeoutError",
                    "message": f"Execution timed out after {timeout} seconds",
                    "traceback": [],
                },
                "execution_time_ms": execution_time_ms,
            })
        except Exception as e:
            execution_time_ms = int((time.time() - start_time) * 1000)
            self.write_success({
                "success": False,
                "execution_count": 0,
                "error": {
                    "type": type(e).__name__,
                    "message": str(e),
                    "traceback": traceback.format_exc().split("\n"),
                },
                "execution_time_ms": execution_time_ms,
            })


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
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


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
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


# =============================================================================
# ファイル・ノートブック管理
# =============================================================================


class ContentsListHandler(BaseCustomHandler):
    """GET/POST /api/contents"""

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
                    contents.append({
                        "name": item["name"],
                        "type": item["type"],
                        "size": item.get("size"),
                        "modified_at": item.get("last_modified"),
                    })
            self.write_success({
                "path": "/" + path if path else "/",
                "contents": contents,
            })
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)

    @web.authenticated
    async def post(self):
        """ノートブックまたはファイルを作成"""
        body = self.get_json_body()
        content_type = body.get("type", "notebook")
        target_path = body.get("path", "")

        try:
            # パストラバーサル対策
            target_path = validate_path(target_path)
            if content_type == "notebook":
                model = await self.contents_manager.new(
                    path=target_path,
                    model={
                        "type": "notebook",
                        "content": {
                            "cells": [],
                            "metadata": {},
                            "nbformat": 4,
                            "nbformat_minor": 5,
                        }
                    },
                )
            else:
                model = await self.contents_manager.new(path=target_path)

            self.write_success({
                "path": "/" + model["path"],
                "type": model["type"],
                "created_at": model.get("created") or model.get("last_modified"),
            })
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


class ContentsHandler(BaseCustomHandler):
    """GET/POST/PUT /api/contents/{path}"""

    @web.authenticated
    async def get(self, path: str):
        """ファイルまたはノートブックの内容を取得"""
        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=True)
            if model["type"] == "notebook":
                self.write_success({
                    "path": "/" + path,
                    "type": "notebook",
                    "content": model["content"],
                    "modified_at": model.get("last_modified"),
                })
            else:
                self.write_success({
                    "path": "/" + path,
                    "type": model["type"],
                    "content": model.get("content"),
                    "modified_at": model.get("last_modified"),
                })
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)

    @web.authenticated
    async def post(self, path: str = ""):
        """ノートブックまたはファイルを作成"""
        body = self.get_json_body()
        content_type = body.get("type", "notebook")
        target_path = body.get("path", path)

        try:
            # パストラバーサル対策
            target_path = validate_path(target_path)
            if content_type == "notebook":
                model = await self.contents_manager.new(
                    path=target_path,
                    model={"type": "notebook", "content": {"cells": [], "metadata": {}}},
                )
            else:
                model = await self.contents_manager.new(path=target_path)

            self.write_success({
                "path": "/" + model["path"],
                "type": model["type"],
                "created_at": model.get("created") or model.get("last_modified"),
            })
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)

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
            self.write_error_response("INTERNAL_ERROR", str(e), 500)

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
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


class ContentsCellsHandler(BaseCustomHandler):
    """PATCH /api/contents/{path}/cells"""

    @web.authenticated
    async def patch(self, path: str):
        """セルを追加・更新・削除"""
        body = self.get_json_body()
        action = body.get("action")
        cell = body.get("cell")
        index = body.get("index")

        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=True)
            if model["type"] != "notebook":
                self.write_error_response("VALIDATION_ERROR", "Not a notebook", 400)
                return

            cells = model["content"].get("cells", [])

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

            elif action == "delete":
                if index is None or index < 0 or index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {index}", 400)
                    return
                cells.pop(index)

            else:
                self.write_error_response("VALIDATION_ERROR", f"Unknown action: {action}", 400)
                return

            model["content"]["cells"] = cells
            await self.contents_manager.save(model, path)
            self.write_success({"path": "/" + path, "status": "updated"})

        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            self.write_error_response("INTERNAL_ERROR", str(e), 500)


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
        (f"{base_url}/api/contents", ContentsListHandler),
        (f"{base_url}/api/contents/(.*)/cells", ContentsCellsHandler),
        (f"{base_url}/api/contents/(.*)", ContentsHandler),
    ]
