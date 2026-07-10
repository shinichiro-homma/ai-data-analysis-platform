"""
カーネル管理・実行・変数取得 REST API ハンドラー
"""

from __future__ import annotations

import logging
import re
import time
from pathlib import Path

from tornado import web

from .base import (
    WORKSPACE_PATH_PREFIX,
    WORKSPACE_ROOT_DIR,
    BaseCustomHandler,
    resolve_workspace_dir,
    utc_now_iso,
    validate_kernel_name,
    validate_timeout,
    workspace_contents_path,
)
from .code_validator import validate_code
from .kernel_executor import KernelExecutor
from .session_handlers import get_kernel_workspace, unregister_kernel

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
                    "started_at": utc_now_iso(),
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
            log.error("Execution error in kernel %s: %s", kernel_id, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to execute code", 500)


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
