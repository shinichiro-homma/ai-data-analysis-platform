"""
セル操作 REST API ハンドラー

ノートブックのセル追加・更新・削除・並び替え・実行・一括実行・出力クリアを提供する。
"""

from __future__ import annotations

import copy as _copy
import logging
import re
import time
from pathlib import Path

from tornado import web

from .base import (
    WORKSPACE_PATH_PREFIX,
    WORKSPACE_ROOT_DIR,
    BaseCustomHandler,
    _apply_lock_token,
    resolve_workspace_dir,
    validate_path,
    validate_timeout,
    workspace_contents_path,
)
from .code_validator import validate_code
from .kernel_executor import KernelExecutor

log = logging.getLogger(__name__)


# =============================================================================
# ヘルパー関数
# =============================================================================


async def resolve_workspace_for_kernel(handler: BaseCustomHandler, kernel_id: str) -> tuple[Path | None, str | None]:
    """
    kernel_id からワークスペースの output_dir と workspace_rel_path を解決する。

    1. session_manager のセッション一覧から kernel_id に対応するセッションを検索し、
       パス (workspaces/{workspace_id}/...) から workspace_id を逆引きする。
    2. _kernel_workspace_map（セッション作成時に登録されたマッピング）から検索する。
    3. セッションが見つからない場合、カーネルの cwd からワークスペースを推定する。

    Returns:
        (output_dir, workspace_rel_path) or (None, None)
    """
    from .session_handlers import get_kernel_workspace

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


# =============================================================================
# セル操作
# =============================================================================


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
        _apply_lock_token(self)
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

            elif action == "merge":
                start_index = body.get("start_index")
                end_index = body.get("end_index")

                if start_index is None or end_index is None:
                    self.write_error_response("VALIDATION_ERROR", "start_index and end_index are required", 400)
                    return
                if not isinstance(start_index, int) or not isinstance(end_index, int):
                    self.write_error_response("VALIDATION_ERROR", "start_index and end_index must be integers", 400)
                    return
                if start_index >= end_index:
                    self.write_error_response(
                        "VALIDATION_ERROR",
                        f"start_index ({start_index}) must be less than end_index ({end_index})",
                        400,
                    )
                    return
                if start_index < 0 or end_index >= len(cells):
                    self.write_error_response(
                        "VALIDATION_ERROR",
                        f"Index out of range: start_index={start_index}, end_index={end_index}, total={len(cells)}",
                        400,
                    )
                    return

                # セルタイプ混在チェック
                cell_types = {cells[i]["cell_type"] for i in range(start_index, end_index + 1)}
                if len(cell_types) > 1:
                    self.write_error_response(
                        "CELL_TYPE_MISMATCH",
                        "Cannot merge cells of different types",
                        400,
                    )
                    return

                # ソースを \n で連結（末尾改行の重複を避ける）
                merged_source = "\n".join(
                    cells[i].get("source", "").rstrip("\n") for i in range(start_index, end_index + 1)
                )
                cell_type = cells[start_index]["cell_type"]
                merged_cell = {
                    "cell_type": cell_type,
                    "source": merged_source,
                    "metadata": cells[start_index].get("metadata", {}),
                }
                if cell_type == "code":
                    merged_cell["outputs"] = []
                    merged_cell["execution_count"] = None

                # 先頭セルを置換し、残りを削除
                cells[start_index] = merged_cell
                del cells[start_index + 1 : end_index + 1]

            elif action == "split":
                split_index = body.get("index")
                split_line = body.get("split_line")

                if split_index is None or split_line is None:
                    self.write_error_response("VALIDATION_ERROR", "index and split_line are required", 400)
                    return
                if not isinstance(split_index, int) or not isinstance(split_line, int):
                    self.write_error_response("VALIDATION_ERROR", "index and split_line must be integers", 400)
                    return
                if split_index < 0 or split_index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {split_index}", 400)
                    return

                source = cells[split_index].get("source", "")
                source_lines = source.split("\n")
                total_lines = len(source_lines)

                if split_line < 1 or split_line >= total_lines:
                    self.write_error_response(
                        "VALIDATION_ERROR",
                        f"split_line ({split_line}) must be between 1 and {total_lines - 1}",
                        400,
                    )
                    return

                cell_type = cells[split_index]["cell_type"]
                metadata = cells[split_index].get("metadata", {})

                first_half = "\n".join(source_lines[:split_line])
                second_half = "\n".join(source_lines[split_line:])

                first_cell = {
                    "cell_type": cell_type,
                    "source": first_half,
                    "metadata": metadata,
                }
                second_cell = {
                    "cell_type": cell_type,
                    "source": second_half,
                    "metadata": {},
                }
                if cell_type == "code":
                    first_cell["outputs"] = []
                    first_cell["execution_count"] = None
                    second_cell["outputs"] = []
                    second_cell["execution_count"] = None

                cells[split_index] = first_cell
                cells.insert(split_index + 1, second_cell)

            elif action == "change_type":
                change_index = body.get("index")
                new_cell_type = body.get("cell_type")

                if change_index is None or new_cell_type is None:
                    self.write_error_response("VALIDATION_ERROR", "index and cell_type are required", 400)
                    return
                if not isinstance(change_index, int) or not isinstance(new_cell_type, str):
                    self.write_error_response(
                        "VALIDATION_ERROR", "index must be integer and cell_type must be string", 400
                    )
                    return
                if new_cell_type not in ("code", "markdown"):
                    self.write_error_response(
                        "VALIDATION_ERROR", f"cell_type must be 'code' or 'markdown', got: {new_cell_type}", 400
                    )
                    return
                if change_index < 0 or change_index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {change_index}", 400)
                    return

                cells[change_index]["cell_type"] = new_cell_type
                cells[change_index]["outputs"] = []
                cells[change_index]["execution_count"] = None

            elif action == "copy":
                copy_index = body.get("index")
                to_index = body.get("to_index")

                if copy_index is None:
                    self.write_error_response("VALIDATION_ERROR", "index is required", 400)
                    return
                if not isinstance(copy_index, int):
                    self.write_error_response("VALIDATION_ERROR", "index must be an integer", 400)
                    return
                if copy_index < 0 or copy_index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {copy_index}", 400)
                    return

                # to_index 省略時は copy_index + 1
                if to_index is None:
                    to_index = copy_index + 1
                if not isinstance(to_index, int):
                    self.write_error_response("VALIDATION_ERROR", "to_index must be an integer", 400)
                    return
                # to_index は 0 〜 len(cells) の範囲（末尾挿入を含む）
                if to_index < 0 or to_index > len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid to_index: {to_index}", 400)
                    return

                copied_cell = _copy.deepcopy(cells[copy_index])
                if copied_cell.get("cell_type") == "code":
                    copied_cell["outputs"] = []
                    copied_cell["execution_count"] = None

                cells.insert(to_index, copied_cell)

            elif action == "clear_output":
                if not isinstance(index, int) or index < 0 or index >= len(cells):
                    self.write_error_response("INVALID_CELL_INDEX", f"Invalid index: {index}", 400)
                    return

                if cells[index].get("cell_type") == "code":
                    cells[index]["outputs"] = []
                    cells[index]["execution_count"] = None

            else:
                self.write_error_response("VALIDATION_ERROR", f"Unknown action: {action}", 400)
                return

            model["content"]["cells"] = cells
            await self.contents_manager.save(model, path)
            self.write_success({"path": "/" + path, "status": "updated"})

        except web.HTTPError:
            # ロック強制（423 等）はそのまま Tornado に伝播させる
            raise
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
        except Exception as e:
            log.error("Failed to update cells '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to update cells", 500)


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
        _apply_lock_token(self)
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
        output_dir, workspace_rel_path = await resolve_workspace_for_kernel(self, kernel_id)

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
        except web.HTTPError:
            # ロック強制（423 等）はそのまま Tornado に伝播させる
            raise
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


class ContentsCellsClearAllOutputsHandler(BaseCustomHandler):
    """POST /api/custom/contents/{path}/cells/clear-all-outputs"""

    @web.authenticated
    async def post(self, path: str):
        """全コードセルの出力をクリアする"""
        _apply_lock_token(self)
        try:
            path = validate_path(path)
        except ValueError as e:
            self.write_error_response("VALIDATION_ERROR", str(e), 400)
            return

        if not path.endswith(".ipynb"):
            self.write_error_response("VALIDATION_ERROR", "Not a notebook: path must end with .ipynb", 400)
            return

        try:
            model = await self.contents_manager.get(path, content=True)
        except FileNotFoundError:
            self.write_error_response("NOTEBOOK_NOT_FOUND", f"Not found: {path}", 404)
            return
        except Exception as e:
            log.error("Failed to load notebook '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to load notebook", 500)
            return

        if model["type"] != "notebook":
            self.write_error_response("VALIDATION_ERROR", "Not a notebook", 400)
            return

        cells = model["content"].get("cells", [])
        cleared_cells = 0

        for cell in cells:
            if cell.get("cell_type") == "code":
                cell["outputs"] = []
                cell["execution_count"] = None
                cleared_cells += 1

        try:
            await self.contents_manager.save(model, path)
        except web.HTTPError:
            # ロック強制（423 等）はそのまま Tornado に伝播させる
            raise
        except Exception as e:
            log.error("Failed to save notebook '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to save notebook", 500)
            return

        self.write_success({"cleared_cells": cleared_cells})


class ContentsCellExecuteBatchHandler(BaseCustomHandler):
    """POST /api/custom/contents/{path}/cells/execute-batch"""

    @web.authenticated
    async def post(self, path: str):
        """指定範囲のセルを一括実行する"""
        _apply_lock_token(self)
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
        output_dir, workspace_rel_path = await resolve_workspace_for_kernel(self, kernel_id)

        executor = KernelExecutor(kernel_id, self.kernel_manager)

        executed_cells = 0
        success_count = 0
        failed_cell = None
        error_info = None

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
                error_info = {
                    "type": "TimeoutError",
                    "message": f"Execution timed out after {validated_timeout} seconds",
                    "traceback": [],
                }
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
                error_info = result["error"]
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
        except web.HTTPError:
            # ロック強制（423 等）はそのまま Tornado に伝播させる
            raise
        except Exception as e:
            log.error("Failed to save notebook '%s': %s", path, e, exc_info=True)
            # 保存失敗は無視して実行結果を返す

        response = {
            "executed_cells": executed_cells,
            "success_count": success_count,
            "failed_cell": failed_cell,
        }
        if error_info is not None:
            response["error"] = error_info
        self.write_success(response)
