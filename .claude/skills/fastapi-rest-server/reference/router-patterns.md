## Router パターン

### 基本構造

各ルーターは `APIRouter` を使い、prefix と tags を設定する。

```python
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..catalog_loader import CatalogStore
from ..dependencies import get_catalog_store
from ..models import TableDetailRequest
from ..responses import detail_response, index_response

router = APIRouter(prefix="/catalog", tags=["catalog"])
```

### インデックスエンドポイント（GET）

一覧を返す軽量エンドポイント。`index_response()` でラップする。

```python
@router.get("/index")
def get_table_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    tables = [t.model_dump() for t in store.get_all_indexes()]
    return index_response("tables", tables)
```

**用語集の例:**
```python
@router.get("/index")
def get_term_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    terms = [t.model_dump() for t in store.get_all_term_indexes()]
    return index_response("terms", terms)
```

### 詳細エンドポイント（POST, 一括取得）

リクエストボディで名前リストを受け取り、found/not_found を返す。`detail_response()` でラップする。

```python
@router.post("/tables", response_model=None)
def get_table_details(
    request: TableDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    tables, not_found = store.get_table_details(request.table_names)
    return detail_response(
        "tables", [t.model_dump(by_alias=True) for t in tables], not_found
    )
```

**用語集の例:**
```python
@router.post("/terms", response_model=None)
def get_term_details(
    request: TermDetailRequest,
    store: CatalogStore = Depends(get_catalog_store),
) -> dict:
    terms, not_found = store.get_term_details(request.term_names)
    return detail_response("terms", [t.model_dump() for t in terms], not_found)
```

### 個別取得エンドポイント（GET + パスパラメータ）

パスパラメータにバリデーション（正規表現、最大長）を適用し、エラーケースを `error_response()` で処理する。

```python
from fastapi import Path as FastAPIPath
from fastapi.responses import JSONResponse

from ..catalog_loader import LogicCodeNotFoundError
from ..responses import error_response

@router.get("/code/{logic_name}", response_model=None)
def get_logic_code(
    logic_name: str = FastAPIPath(..., pattern=r"^[a-zA-Z0-9_-]+$", max_length=100),
    store: CatalogStore = Depends(get_catalog_store),
) -> dict | JSONResponse:
    try:
        result = store.get_logic_code(logic_name)
    except LogicCodeNotFoundError:
        return error_response(
            404, "LOGIC_CODE_NOT_FOUND",
            f"Code file for logic '{logic_name}' not found",
        )
    if result is None:
        return error_response(404, "LOGIC_NOT_FOUND", f"Logic '{logic_name}' not found")
    return {"data": result}
```

### 管理エンドポイント

リロードなどの管理操作。`Request` オブジェクトを直接受け取って `app.state` を更新する。

```python
import logging
import time
from datetime import datetime, timezone

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
        return error_response(
            400, "CATALOG_LOAD_ERROR",
            "Failed to reload catalog. Check server logs for details."
        )
    except Exception as exc:
        logger.exception("Unexpected error during catalog reload")
        return error_response(500, "INTERNAL_ERROR", "Unexpected error during reload.")
    elapsed_ms = int((time.monotonic() - start) * 1000)
    request.app.state.last_reload = datetime.now(timezone.utc).isoformat()
    return {
        "data": {
            "status": "reloaded",
            "tables_loaded": loaded["tables"],
            "terms_loaded": loaded["terms"],
            "logic_loaded": loaded["logic"],
            "reload_time_ms": elapsed_ms,
        }
    }
```

## 依存性注入

### dependencies.py

`app.state` からストアを取得する関数。ルーターの `Depends()` で使用する。

```python
from __future__ import annotations

from fastapi import Request

from .catalog_loader import CatalogStore


def get_catalog_store(request: Request) -> CatalogStore:
    """リクエストから CatalogStore を取得する依存関数。"""
    return request.app.state.catalog_store
```

### ルーターでの使用パターン

```python
from fastapi import Depends

from ..dependencies import get_catalog_store
from ..catalog_loader import CatalogStore

@router.get("/index")
def get_table_index(store: CatalogStore = Depends(get_catalog_store)) -> dict:
    ...
```
