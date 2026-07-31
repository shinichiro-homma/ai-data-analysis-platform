from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from ..catalog_loader import CatalogStore
from ..config import DATA_DIR
from ..exceptions import CatalogLoadError
from ..models import ReloadResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

_reload_lock = threading.Lock()


@router.post("/reload", response_model=ReloadResponse)
def reload_catalog(
    request: Request,
) -> dict:
    with _reload_lock:
        start = time.monotonic()
        try:
            new_store = CatalogStore()
            loaded = new_store.load_all(DATA_DIR)
        except (ValueError, OSError) as exc:
            logger.error("Catalog reload failed: %s", exc)
            raise CatalogLoadError() from exc
        elapsed_ms = int((time.monotonic() - start) * 1000)
        request.app.state.catalog_store = new_store
        request.app.state.last_reload = datetime.now(UTC).isoformat()
    return {
        "data": {
            "status": "reloaded",
            "tables_loaded": loaded["tables"]["loaded"],
            "terms_loaded": loaded["terms"]["loaded"],
            "logic_loaded": loaded["logic"]["loaded"],
            "reload_time_ms": elapsed_ms,
            "skipped_files": new_store.skipped_files,
        }
    }
