"""
ワークスペース内セッション作成 REST API ハンドラー

ワークスペースの作業ディレクトリ（cwd）にカーネルを起動するカスタムエンドポイントを提供する。
標準の Jupyter カーネル API は REST レベルで cwd をサポートしないため、カスタムエンドポイントが必要。
"""

import asyncio
import logging
from pathlib import Path

from tornado import web

from .base import (
    BaseCustomHandler,
    resolve_workspace_dir,
    utc_now_iso,
    validate_kernel_name,
    validate_workspace_id,
    workspace_contents_path,
)
from .kernel_executor import KernelExecutor, cleanup_kernel_state
from .workspace_sandbox import generate_sandbox_code

log = logging.getLogger(__name__)

# kernel_id → workspace_id のマッピング
# notebook_path なしでセッションを作成した場合、Jupyter の session_manager に登録されないため、
# ワークスペース解決のためにこのマッピングを使用する
_kernel_workspace_map: dict[str, str] = {}


def get_kernel_workspace(kernel_id: str) -> str | None:
    """kernel_id に対応する workspace_id を返す"""
    return _kernel_workspace_map.get(kernel_id)


def register_kernel_workspace(kernel_id: str, workspace_id: str) -> None:
    """kernel_id → workspace_id のマッピングを登録する"""
    _kernel_workspace_map[kernel_id] = workspace_id


def unregister_kernel(kernel_id: str) -> None:
    """カーネル削除時のクリーンアップ（マッピング除去）"""
    _kernel_workspace_map.pop(kernel_id, None)
    cleanup_kernel_state(kernel_id)


class CustomSessionsHandler(BaseCustomHandler):
    """POST /api/custom/sessions"""

    @web.authenticated
    async def post(self):
        """ワークスペース内でカーネルを起動し、セッション情報を返す"""
        body = self.get_json_body()
        workspace_id = body.get("workspace_id")
        notebook_path = body.get("notebook_path")
        kernel_name = body.get("kernel_name", "python3")

        # バリデーション: workspace_id
        ws_error = validate_workspace_id(workspace_id)
        if ws_error:
            self.write_error_response("VALIDATION_ERROR", ws_error, 400)
            return

        # kernel_name のバリデーション
        kn_error = validate_kernel_name(kernel_name)
        if kn_error:
            self.write_error_response("VALIDATION_ERROR", kn_error, 400)
            return

        # notebook_path のバリデーション
        if notebook_path is not None:
            if not isinstance(notebook_path, str):
                self.write_error_response("VALIDATION_ERROR", "notebook_path must be a string", 400)
                return
            if ".." in notebook_path or "\0" in notebook_path:
                self.write_error_response("VALIDATION_ERROR", "notebook_path contains invalid characters", 400)
                return
            if len(notebook_path) > 255:
                self.write_error_response(
                    "VALIDATION_ERROR",
                    "notebook_path exceeds maximum length (255 characters)",
                    400,
                )
                return

        # ワークスペースの絶対パスを取得（パストラバーサル対策フェイルセーフ）
        try:
            workspace_dir = resolve_workspace_dir(workspace_id)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", "Invalid workspace_id", 400)
            return

        # ワークスペースの存在確認
        if not workspace_dir.exists() or not workspace_dir.is_dir():
            self.write_error_response("WORKSPACE_NOT_FOUND", f"Workspace not found: {workspace_id}", 404)
            return

        # metadata.json の存在確認（正規のワークスペースであることを確認）
        if not (workspace_dir / "metadata.json").exists():
            self.write_error_response(
                "WORKSPACE_NOT_FOUND",
                f"Workspace metadata not found: {workspace_id}",
                404,
            )
            return

        kernel_id = None
        try:
            # カーネル起動（cwd=workspace_dir）
            # MappingKernelManager.start_kernel() は cwd キーワード引数をサポートしている
            kernel_id = await self.kernel_manager.start_kernel(
                kernel_name=kernel_name,
                cwd=str(workspace_dir),
            )

            # カーネルが IOPub チャンネルの準備を完了するまで待つ
            # ZeroMQ の SUB ソケット接続確立に必要な待機時間
            await asyncio.sleep(2)

            # ワークスペースサンドボックスを注入
            executor = KernelExecutor(kernel_id, self.kernel_manager)
            sandbox_code = generate_sandbox_code(str(workspace_dir), workspace_id)
            sandbox_result = await executor.execute(sandbox_code, timeout=30)
            if not sandbox_result["success"]:
                await self.kernel_manager.shutdown_kernel(kernel_id, now=True)
                error_msg = sandbox_result.get("error", {}).get("message", "Unknown error")
                log.error(
                    "Sandbox initialization failed for workspace %s: %s",
                    workspace_id,
                    error_msg,
                )
                self.write_error_response(
                    "INTERNAL_ERROR",
                    "Failed to initialize workspace environment",
                    500,
                )
                return

            # kernel_id → workspace_id マッピングを登録
            register_kernel_workspace(kernel_id, workspace_id)

            response = {
                "kernel_id": kernel_id,
                "workspace_id": workspace_id,
                "status": "starting",
                "created_at": utc_now_iso(),
            }

            if notebook_path:
                # notebook_path がある場合は Jupyter セッションも作成する
                # セッションを作成することでユーザーがそのノートブックを開いたときに
                # 同じカーネルを共有できる

                # パスプレフィックス二重化防止:
                # notebook_create の戻り値（workspaces/ws-XXX/file.ipynb）を
                # そのまま渡された場合、プレフィックスを除去する
                workspace_prefix = f"{workspace_contents_path(workspace_id)}/"
                if notebook_path.startswith(workspace_prefix):
                    notebook_path = notebook_path[len(workspace_prefix) :]

                full_notebook_path = f"{workspace_contents_path(workspace_id)}/{notebook_path}"
                notebook_name = Path(notebook_path).name

                session_manager = self.settings.get("session_manager")
                if session_manager is not None:
                    session = await session_manager.create_session(
                        path=full_notebook_path,
                        name=notebook_name,
                        type="notebook",
                        kernel_id=kernel_id,
                    )
                    session_id = session["id"]
                else:
                    log.warning("session_manager is not available; using kernel_id as session_id")
                    session_id = kernel_id

                response["session_id"] = session_id
                response["notebook_path"] = full_notebook_path
            else:
                # notebook_path なし: カーネルのみ（kernel_id = session_id）
                response["session_id"] = kernel_id

            self.write_success(response)

        except Exception as e:
            if kernel_id:
                try:
                    await self.kernel_manager.shutdown_kernel(kernel_id, now=True)
                except Exception as shutdown_err:
                    log.warning("Failed to shutdown kernel %s during cleanup: %s", kernel_id, shutdown_err)
            log.error("Unexpected error in CustomSessionsHandler.post: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "An internal error occurred", 500)
