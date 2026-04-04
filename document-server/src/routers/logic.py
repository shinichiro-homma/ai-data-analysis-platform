from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi import Path as FastAPIPath
from fastapi.responses import JSONResponse

from ..catalog_loader import CatalogStore, LogicCodeNotFoundError
from ..dependencies import get_catalog_store
from ..models import LogicMetaRequest
from ..responses import detail_response, error_response, index_response

router = APIRouter(prefix="/logic", tags=["logic"])


@router.get("/index")
def get_logic_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    logic = [item.model_dump() for item in store.get_all_logic_indexes()]
    return index_response("logic", logic)


@router.post("/meta", response_model=None)
def get_logic_meta(
    request: LogicMetaRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    metas, not_found = store.get_logic_metas(request.logic_names)
    return detail_response("logic", [m.model_dump() for m in metas], not_found)


@router.get("/code/{logic_name}", response_model=None)
def get_logic_code(
    logic_name: str = FastAPIPath(..., pattern=r"^[a-zA-Z0-9_-]+$", max_length=100),
    store: CatalogStore = Depends(get_catalog_store),
) -> dict | JSONResponse:
    try:
        result = store.get_logic_code(logic_name)
    except LogicCodeNotFoundError:
        return error_response(
            404,
            "LOGIC_CODE_NOT_FOUND",
            f"Code file for logic '{logic_name}' not found",
        )
    if result is None:
        return error_response(404, "LOGIC_NOT_FOUND", f"Logic '{logic_name}' not found")
    return {"data": result}
