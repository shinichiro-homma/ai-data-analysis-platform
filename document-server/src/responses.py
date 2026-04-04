from __future__ import annotations

from fastapi.responses import JSONResponse


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """統一的なエラーレスポンスを生成する。"""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def index_response(key: str, items: list[dict]) -> dict:
    """インデックス一覧レスポンスを生成する。"""
    return {"data": {key: items, "total": len(items)}}


def detail_response(key: str, items: list[dict], not_found: list[str]) -> dict:
    """詳細一括取得レスポンスを生成する。"""
    return {"data": {key: items, "not_found": not_found}}
