"""
ワークスペース管理 REST API ハンドラー

チャット（AI会話）ごとに独立した作業空間（ワークスペース）の作成・一覧を提供する。
"""

import asyncio
import json
import logging
import uuid
from pathlib import Path

from tornado import web

from .base import WORKSPACE_ROOT_DIR, BaseCustomHandler, utc_now_iso, validate_workspace_id, workspace_contents_path

# テンプレートディレクトリ（extensions/custom_api/ の2階層上 = jupyter-server/）
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"

log = logging.getLogger(__name__)


def _ensure_workspace_root() -> Path:
    """ワークスペースルートディレクトリのPathオブジェクトを返す。存在しなければ作成する。"""
    root = Path(WORKSPACE_ROOT_DIR)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _generate_workspace_id() -> str:
    """ワークスペースIDを生成する（ws-{uuid短縮}）"""
    return f"ws-{uuid.uuid4().hex[:8]}"


_INFRA_ENTRIES = {"metadata.json", "data", "output"}


_VALID_STATUSES = {"not_started", "in_progress", "completed", "blocked"}


def _validate_workspace_metadata(summary, status, *, summary_required=False, status_required=False):
    """summary と status の共通バリデーション。エラーメッセージを返す。問題なければ None。"""
    if summary is not None:
        if not isinstance(summary, str):
            return "summary must be a string"
        if len(summary) > 200:
            return "summary exceeds maximum length (200 characters)"

    if status is not None and status not in _VALID_STATUSES:
        return f"status must be one of: {', '.join(sorted(_VALID_STATUSES))}"

    return None


def _format_workspace_info(
    workspace_id: str, name: str, created_at: str, summary: str = "", status: str = "not_started"
) -> dict:
    """ワークスペース情報の基本レスポンス形式を返す"""
    ws_path = workspace_contents_path(workspace_id)
    return {
        "workspace_id": workspace_id,
        "name": name,
        "path": ws_path,
        "data_path": f"{ws_path}/data",
        "output_path": f"{ws_path}/output",
        "created_at": created_at,
        "summary": summary,
        "status": status,
    }


def _read_workspace(workspace_dir: Path) -> dict | None:
    """ワークスペースディレクトリからメタデータを読み取る。不正なディレクトリは None を返す。"""
    metadata_path = workspace_dir / "metadata.json"
    if not metadata_path.exists():
        return None
    try:
        with open(metadata_path, encoding="utf-8") as f:
            metadata = json.load(f)
        # ファイルカウント（metadata.json, data/, output/ を除外）
        file_count = sum(1 for p in workspace_dir.iterdir() if p.name not in _INFRA_ENTRIES)
        # 後方互換: 既存ワークスペースに summary/status がない場合はデフォルト値を使用
        summary = metadata.get("summary", "")
        status = metadata.get("status", "not_started")
        info = _format_workspace_info(
            metadata["workspace_id"], metadata["name"], metadata["created_at"], summary, status
        )
        return {**info, "file_count": file_count}
    except (json.JSONDecodeError, KeyError, OSError):
        return None


def _create_workspace_sync(root: Path, name: str, summary: str, status: str) -> dict:
    """ワークスペースのディレクトリ作成とメタデータ書き込みを同期的に行う"""
    workspace_id = _generate_workspace_id()
    workspace_dir = root / workspace_id
    workspace_dir.mkdir(parents=True, exist_ok=True)
    (workspace_dir / "data").mkdir(exist_ok=True)
    (workspace_dir / "output").mkdir(exist_ok=True)

    created_at = utc_now_iso()
    metadata = {
        "workspace_id": workspace_id,
        "name": name.strip(),
        "created_at": created_at,
        "summary": summary,
        "status": status,
    }

    metadata_path = workspace_dir / "metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False)

    return {
        "workspace_id": workspace_id,
        "name": metadata["name"],
        "created_at": created_at,
        "summary": summary,
        "status": status,
    }


def _list_workspaces_sync(root: Path) -> list[dict]:
    """ワークスペース一覧を同期的に取得する"""
    workspaces = []
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        ws = _read_workspace(entry)
        if ws is not None:
            workspaces.append(ws)
    workspaces.sort(key=lambda w: w["created_at"], reverse=True)
    return workspaces


def _update_workspace_sync(metadata_path: Path, summary, status) -> dict:
    """ワークスペースメタデータを同期的に更新する

    Raises:
        FileNotFoundError: メタデータファイルが存在しない場合
    """
    if not metadata_path.exists():
        raise FileNotFoundError(f"Workspace metadata not found: {metadata_path}")

    with open(metadata_path, encoding="utf-8") as f:
        metadata = json.load(f)

    if summary is not None:
        metadata["summary"] = summary
    if status is not None:
        metadata["status"] = status

    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False)

    return metadata


def _read_templates_sync(templates_dir: Path) -> tuple[str, str]:
    """テンプレートファイルを同期的に読み込む"""
    template_path = templates_dir / "summary_template.md"
    criteria_path = templates_dir / "verification_criteria.md"
    template = template_path.read_text(encoding="utf-8")
    verification_criteria = criteria_path.read_text(encoding="utf-8")
    return template, verification_criteria


class WorkspacesHandler(BaseCustomHandler):
    """POST /api/workspaces, GET /api/workspaces"""

    @web.authenticated
    async def post(self):
        """ワークスペースを作成する"""
        body = self.get_json_body()
        name = body.get("name", "")
        summary = body.get("summary", "")
        status = body.get("status", "not_started")

        # name バリデーション
        if not isinstance(name, str) or not name.strip():
            self.write_error_response("VALIDATION_ERROR", "name is required", 400)
            return

        if len(name) > 100:
            self.write_error_response("VALIDATION_ERROR", "name exceeds maximum length (100 characters)", 400)
            return

        # summary / status バリデーション（共通関数）
        metadata_error = _validate_workspace_metadata(summary, status)
        if metadata_error:
            self.write_error_response("VALIDATION_ERROR", metadata_error, 400)
            return

        try:
            root = _ensure_workspace_root()
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, _create_workspace_sync, root, name, summary, status)

            self.write_success(
                _format_workspace_info(
                    result["workspace_id"],
                    result["name"],
                    result["created_at"],
                    result["summary"],
                    result["status"],
                )
            )
        except Exception as e:
            log.error("Failed to create workspace: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to create workspace", 500)

    @web.authenticated
    async def get(self):
        """ワークスペース一覧を取得する"""
        try:
            root = _ensure_workspace_root()
            loop = asyncio.get_running_loop()
            workspaces = await loop.run_in_executor(None, _list_workspaces_sync, root)

            self.write_success({"workspaces": workspaces})
        except Exception as e:
            log.error("Failed to list workspaces: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to list workspaces", 500)


class WorkspaceHandler(BaseCustomHandler):
    """PUT /api/workspaces/{workspace_id}"""

    @web.authenticated
    async def put(self, workspace_id: str):
        """ワークスペースのメタデータを更新する"""
        # workspace_id バリデーション
        ws_error = validate_workspace_id(workspace_id)
        if ws_error:
            self.write_error_response("VALIDATION_ERROR", ws_error, 400)
            return

        body = self.get_json_body()
        summary = body.get("summary")
        status = body.get("status")

        # summary と status の両方が未指定の場合はエラー
        if summary is None and status is None:
            self.write_error_response("VALIDATION_ERROR", "At least one of summary or status is required", 400)
            return

        # summary / status バリデーション（共通関数）
        metadata_error = _validate_workspace_metadata(summary, status)
        if metadata_error:
            self.write_error_response("VALIDATION_ERROR", metadata_error, 400)
            return

        try:
            root = _ensure_workspace_root()
            workspace_dir = root / workspace_id

            metadata_path = workspace_dir / "metadata.json"

            loop = asyncio.get_running_loop()
            metadata = await loop.run_in_executor(None, _update_workspace_sync, metadata_path, summary, status)

            self.write_success(
                _format_workspace_info(
                    metadata["workspace_id"],
                    metadata["name"],
                    metadata["created_at"],
                    metadata.get("summary", ""),
                    metadata.get("status", "not_started"),
                )
            )
        except FileNotFoundError:
            self.write_error_response("NOT_FOUND", f"Workspace not found: {workspace_id}", 404)
        except json.JSONDecodeError:
            log.error("Corrupted metadata.json for workspace %s", workspace_id)
            self.write_error_response("INTERNAL_ERROR", "Workspace metadata is corrupted", 500)
        except Exception as e:
            log.error("Failed to update workspace %s: %s", workspace_id, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to update workspace", 500)


class WorkspaceSummarizeHandler(BaseCustomHandler):
    """POST /api/workspaces/{workspace_id}/summarize"""

    @web.authenticated
    async def post(self, workspace_id: str):
        """サマリ生成用テンプレート・検証観点を返却する"""
        # workspace_id バリデーション
        ws_error = validate_workspace_id(workspace_id)
        if ws_error:
            self.write_error_response("VALIDATION_ERROR", ws_error, 400)
            return

        # ワークスペースの存在確認 + テンプレートファイル読み込み（スレッドプールで実行）
        root = _ensure_workspace_root()
        workspace_dir = root / workspace_id
        metadata_path = workspace_dir / "metadata.json"

        def _check_workspace_and_read_templates():
            if not metadata_path.exists():
                raise FileNotFoundError(f"Workspace not found: {workspace_id}")
            return _read_templates_sync(_TEMPLATES_DIR)

        try:
            loop = asyncio.get_running_loop()
            template, verification_criteria = await loop.run_in_executor(None, _check_workspace_and_read_templates)
        except FileNotFoundError as e:
            error_msg = str(e)
            if "Workspace not found" in error_msg:
                self.write_error_response("NOT_FOUND", error_msg, 404)
            else:
                log.error("Template file not found: %s", e)
                self.write_error_response("INTERNAL_ERROR", "Template file not found", 500)
            return
        except Exception as e:
            log.error("Failed to read template files: %s", e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to read template files", 500)
            return

        instructions = (
            "以下の手順でサマリーを作成してください:\n"
            "1. template の「検証シナリオ」セクションに、分析テーマ・背景・成功条件を記入する\n"
            "2. 「検証の経過と所見」に、全体の流れと注目すべき場面を記述する\n"
            "3. 「成功条件の達成判定」テーブルに、各条件の判定（○/△/×）とコメントを記入する\n"
            "4. 「考察」セクションに、得意/苦手/改善可能/本質的困難/残った疑問を記述する\n"
            "5. verification_criteria を参照して「検証観点の評価」テーブルに評価と根拠を記入する\n"
            "6. 完成したサマリーを SUMMARY.md としてワークスペースに保存する"
        )

        self.write_success(
            {
                "workspace_id": workspace_id,
                "template": template,
                "verification_criteria": verification_criteria,
                "instructions": instructions,
            }
        )
