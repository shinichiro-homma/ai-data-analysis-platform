"""
ファイル・ノートブック管理 REST API ハンドラー

ファイル一覧取得、ノートブック作成・読取・更新・削除を提供する。
"""

from __future__ import annotations

import logging

from tornado import web

from .base import (
    BaseCustomHandler,
    _apply_lock_token,
    validate_path,
)

log = logging.getLogger(__name__)


# =============================================================================
# ヘルパー関数
# =============================================================================


async def _find_available_path(contents_manager, target_path: str) -> str:
    """
    既存ファイルとの重複を避けるため、自動連番でパスを探索する。

    target_path が既に存在する場合:
      name.ipynb -> name_2.ipynb -> name_3.ipynb -> ...
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
        await _create_content_response(self, body, path_default="")


async def _create_content_response(handler, body: dict, path_default: str = "") -> None:
    """ContentsListHandler.post / ContentsHandler.post の共通ヘルパー。

    Args:
        handler: BaseCustomHandler インスタンス
        body: リクエストボディ dict
        path_default: body に path が含まれない場合のデフォルト値
    """
    content_type = body.get("type", "notebook")
    target_path = body.get("path", path_default)

    try:
        # パストラバーサル対策
        target_path = validate_path(target_path)
        # 既存ファイルとの重複を避ける自動連番
        target_path = await _find_available_path(handler.contents_manager, target_path)
        model = await _create_content(handler.contents_manager, target_path, content_type)

        handler.write_success(
            {
                "path": "/" + model["path"],
                "type": model["type"],
                "created_at": model.get("created") or model.get("last_modified"),
            }
        )
    except Exception as e:
        log.error("Failed to create content: %s", e, exc_info=True)
        handler.write_error_response("INTERNAL_ERROR", "Failed to create content", 500)


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
        await _create_content_response(self, body, path_default=path)

    @web.authenticated
    async def put(self, path: str):
        """ファイルまたはノートブックを更新"""
        _apply_lock_token(self)
        body = self.get_json_body()
        content = body.get("content")

        try:
            # パストラバーサル対策
            path = validate_path(path)
            model = await self.contents_manager.get(path, content=False)
            model["content"] = content
            await self.contents_manager.save(model, path)
            self.write_success({"path": "/" + path, "status": "updated"})
        except web.HTTPError:
            # ロック強制（423 等）はそのまま Tornado に伝播させる
            raise
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
