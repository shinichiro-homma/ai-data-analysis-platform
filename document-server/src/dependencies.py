from __future__ import annotations

from fastapi import Request

from .catalog_loader import CatalogStore


def get_catalog_store(request: Request) -> CatalogStore:
    """リクエストから CatalogStore を取得する依存関数。"""
    return request.app.state.catalog_store
