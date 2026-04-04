from __future__ import annotations

from fastapi import APIRouter, Depends

from ..catalog_loader import CatalogStore
from ..dependencies import get_catalog_store
from ..models import TableDetailRequest
from ..responses import detail_response, index_response

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/index")
def get_table_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    tables = [t.model_dump() for t in store.get_all_indexes()]
    return index_response("tables", tables)


@router.post("/tables", response_model=None)
def get_table_details(
    request: TableDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    tables, not_found = store.get_table_details(request.table_names)
    return detail_response("tables", [t.model_dump(by_alias=True) for t in tables], not_found)
