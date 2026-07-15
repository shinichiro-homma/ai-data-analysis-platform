"""
カスタム REST API ハンドラー

api-contracts.md に定義された仕様に従った API を提供する。
"""

from __future__ import annotations

import logging
import time
from datetime import datetime

from tornado import web

from .ai_events import AiEventsPostHandler, AiEventsWebSocketHandler
from .base import (
    BaseCustomHandler,
    validate_kernel_name,
    validate_timeout,
)
from .cell_handlers import (
    ContentsCellExecuteBatchHandler,
    ContentsCellExecuteHandler,
    ContentsCellsClearAllOutputsHandler,
    ContentsCellsHandler,
    resolve_workspace_for_kernel,
)
from .code_validator import validate_code
from .contents_handlers import ContentsHandler, ContentsListHandler
from .kernel_executor import KernelExecutor
from .lock_handlers import NotebookLocksHandler
from .preview_handlers import ContentsPreviewHandler
from .session_handlers import CustomSessionsHandler, unregister_kernel
from .sql_handlers import SqlExecuteHandler, SqlExportHandler
from .workspace_handlers import WorkspaceHandler, WorkspacesHandler, WorkspaceSummarizeHandler

log = logging.getLogger(__name__)


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
        output_dir, workspace_rel_path = await resolve_workspace_for_kernel(self, kernel_id)

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
# 同期状態照会
# =============================================================================


class SyncStateHandler(BaseCustomHandler):
    """GET /api/ai/sync-state"""

    @web.authenticated
    def get(self):
        from . import sync_state

        payload = sync_state.get_sync_state_payload()
        self.write_success(payload)


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
        (f"{base_url}/api/custom/contents/(.*)/cells/clear-all-outputs", ContentsCellsClearAllOutputsHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells", ContentsCellsHandler),
        (f"{base_url}/api/custom/contents/(.*)/preview", ContentsPreviewHandler),
        (f"{base_url}/api/custom/contents/(.*)", ContentsHandler),
        # AI同期イベント
        (f"{base_url}/api/ai/events", AiEventsWebSocketHandler),
        (f"{base_url}/api/ai/events/broadcast", AiEventsPostHandler),
        # ノートブックロック（取得/解放/延長）
        (f"{base_url}/api/ai/locks", NotebookLocksHandler),
        # 同期状態照会（再接続時の再同期用）
        (f"{base_url}/api/ai/sync-state", SyncStateHandler),
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
