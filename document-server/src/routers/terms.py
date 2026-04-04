from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..catalog_loader import CatalogStore
from ..dependencies import get_catalog_store
from ..models import TermDetailRequest
from ..responses import detail_response, index_response

router = APIRouter(prefix="/glossary", tags=["glossary"])


@router.get("/index")
def get_term_index(
    store: CatalogStore = Depends(get_catalog_store),
    query: str | None = Query(default=None, max_length=200, description="検索キーワード（name + aliases 部分一致）"),
) -> dict:
    if query:
        terms = [t.model_dump() for t in store.search_term_indexes(query)]
    else:
        terms = [t.model_dump() for t in store.get_all_term_indexes()]
    return index_response("terms", terms)


@router.post("/terms", response_model=None)
def get_term_details(
    request: TermDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    terms, not_found = store.get_term_details(request.term_names)
    return detail_response("terms", [t.model_dump() for t in terms], not_found)
