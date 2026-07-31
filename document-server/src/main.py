from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import pydantic
from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter

from .auth import verify_token
from .catalog_loader import CatalogStore
from .config import CORS_ORIGINS, DATA_DIR, DATA_ENV
from .exceptions import AppError
from .responses import error_response
from .routers import admin, logic, tables, terms

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if not DATA_DIR.is_dir():
        raise RuntimeError(f"Data directory not found: {DATA_DIR} (DATA_ENV={DATA_ENV})")
    store = CatalogStore()
    try:
        store.load_all(DATA_DIR)
    except (ValueError, OSError) as exc:
        logger.error("Failed to load catalog on startup: %s", exc)
        raise RuntimeError(f"Catalog load failed: {exc}") from exc
    app.state.catalog_store = store
    app.state.last_reload = datetime.now(UTC).isoformat()
    skipped = store.skipped_files
    logger.info(
        "Catalog loaded: %d tables, %d terms, %d logic (skipped: tables=%d, terms=%d, logic=%d)",
        store.table_count,
        store.term_count,
        store.logic_count,
        skipped["tables"],
        skipped["terms"],
        skipped["logic"],
    )
    yield


app = FastAPI(title="document-server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


# /health is exempt from authentication (used by Docker healthcheck).
@app.get("/health")
def health() -> dict:
    store: CatalogStore = app.state.catalog_store
    return {
        "status": "healthy",
        "version": app.version,
        "catalog": {
            "tables": store.table_count,
            "terms": store.term_count,
            "logic": store.logic_count,
            "last_reload": app.state.last_reload,
            "skipped_files": store.skipped_files,
        },
    }


# All other routes require Bearer token authentication.
protected_router = APIRouter(dependencies=[Depends(verify_token)])
protected_router.include_router(tables.router)
protected_router.include_router(terms.router)
protected_router.include_router(logic.router)
protected_router.include_router(admin.router)

app.include_router(protected_router)


# --- Exception handlers ---


@app.exception_handler(AppError)
async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
    return error_response(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(422, "VALIDATION_ERROR", str(exc))


@app.exception_handler(pydantic.ValidationError)
async def pydantic_validation_error_handler(_request: Request, exc: pydantic.ValidationError) -> JSONResponse:
    return error_response(422, "VALIDATION_ERROR", str(exc))


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception: %s", exc)
    return error_response(500, "INTERNAL_ERROR", "Internal server error")
