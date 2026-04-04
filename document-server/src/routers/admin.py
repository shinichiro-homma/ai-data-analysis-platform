from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..catalog_loader import CatalogStore
from ..config import DATA_DIR
from ..dependencies import get_catalog_store
from ..responses import error_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/reload", response_model=None)
def reload_catalog(
    request: Request,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict | JSONResponse:
    start = time.monotonic()
    try:
        loaded = store.load_all(DATA_DIR)
    except (ValueError, OSError) as exc:
        logger.error("Catalog reload failed: %s", exc)
        return error_response(400, "CATALOG_LOAD_ERROR", "Failed to reload catalog. Check server logs for details.")
    except Exception:
        logger.exception("Unexpected error during catalog reload")
        return error_response(500, "INTERNAL_ERROR", "Unexpected error during reload.")
    elapsed_ms = int((time.monotonic() - start) * 1000)
    request.app.state.last_reload = datetime.now(UTC).isoformat()
    return {
        "data": {
            "status": "reloaded",
            "tables_loaded": loaded["tables"],
            "terms_loaded": loaded["terms"],
            "logic_loaded": loaded["logic"],
            "reload_time_ms": elapsed_ms,
        }
    }
