from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from src.catalog_loader import CatalogStore
from src.main import app

from .conftest import (
    _COMMON_TERM_YAMLS,
    SAMPLE_INDEX_YAML,
    SAMPLE_LOGIC_INDEX_YAML,
    SAMPLE_LOGIC_META_REMAPPING_YAML,
    SAMPLE_TABLE_YAML,
    SAMPLE_TERM_INDEX_YAML,
    _create_data_dir,
)

# --- GET /logic/index ---


def test_get_logic_index(client: TestClient) -> None:
    resp = client.get("/logic/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 2
    names = {item["logic_name"] for item in data["logic"]}
    assert "member_id_remapping" in names
    assert "sales_basic_aggregation" in names


def test_get_logic_index_fields(client: TestClient) -> None:
    resp = client.get("/logic/index")
    data = resp.json()["data"]
    item = next(i for i in data["logic"] if i["logic_name"] == "member_id_remapping")
    assert item["summary"] == "統合会員IDの洗い替え処理"
    assert item["category"] == "前処理"


# --- POST /logic/meta ---


def test_get_logic_meta(client: TestClient) -> None:
    resp = client.post("/logic/meta", json={"logic_names": ["member_id_remapping"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["logic"]) == 1
    assert data["not_found"] == []
    meta = data["logic"][0]
    assert meta["logic_name"] == "member_id_remapping"
    assert meta["language"] == "sql"
    assert meta["usage_type"] == "template"
    assert "purchase_history" in meta["input_tables"]


def test_get_logic_meta_optional_fields(client: TestClient) -> None:
    """任意フィールドの有無確認。"""
    resp = client.post("/logic/meta", json={"logic_names": ["member_id_remapping"]})
    meta = resp.json()["data"]["logic"][0]
    assert meta["usage_context"] is not None
    assert meta["related_logic"] == ["sales_basic_aggregation"]
    assert meta["notes"] is not None

    resp2 = client.post("/logic/meta", json={"logic_names": ["sales_basic_aggregation"]})
    meta2 = resp2.json()["data"]["logic"][0]
    assert meta2["usage_context"] is None
    assert meta2["related_logic"] is None
    assert meta2["notes"] is None


def test_get_logic_meta_partial_not_found(client: TestClient) -> None:
    resp = client.post(
        "/logic/meta",
        json={"logic_names": ["member_id_remapping", "nonexistent"]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["logic"]) == 1
    assert data["logic"][0]["logic_name"] == "member_id_remapping"
    assert data["not_found"] == ["nonexistent"]


def test_get_logic_meta_all_not_found(client: TestClient) -> None:
    resp = client.post("/logic/meta", json={"logic_names": ["nonexistent"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["logic"]) == 0
    assert data["not_found"] == ["nonexistent"]


def test_get_logic_meta_empty_names(client: TestClient) -> None:
    resp = client.post("/logic/meta", json={"logic_names": []})
    assert resp.status_code == 422
    body = resp.json()
    assert "error" in body, f"Expected 'error' key in response, got: {body}"
    error = body["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert "message" in error


# --- GET /logic/code/{logic_name} ---


def test_get_logic_code(client: TestClient) -> None:
    resp = client.get("/logic/code/member_id_remapping")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["logic_name"] == "member_id_remapping"
    assert data["language"] == "sql"
    assert "COALESCE" in data["code"]


def test_get_logic_code_python(client: TestClient) -> None:
    resp = client.get("/logic/code/sales_basic_aggregation")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["logic_name"] == "sales_basic_aggregation"
    assert data["language"] == "python"
    assert "import pandas" in data["code"]


def test_get_logic_code_not_found(client: TestClient) -> None:
    resp = client.get("/logic/code/nonexistent")
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "LOGIC_NOT_FOUND"


def test_get_logic_code_file_missing(tmp_path: Path) -> None:
    """メタはあるがコードファイルがない場合。"""
    data_dir = _create_data_dir(
        tmp_path,
        index_yaml=SAMPLE_INDEX_YAML,
        table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
        term_index_yaml=SAMPLE_TERM_INDEX_YAML,
        term_yamls=_COMMON_TERM_YAMLS,
        logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
        logic_meta_yamls={"member_id_remapping.yaml": SAMPLE_LOGIC_META_REMAPPING_YAML},
        logic_code_files={},  # コードファイルなし
    )
    store = CatalogStore()
    store.load_tables(data_dir)
    store.load_terms(data_dir)
    store.load_logic(data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"
    test_client = TestClient(app)
    test_client.headers.update({"Authorization": "Bearer test-token"})

    resp = test_client.get("/logic/code/member_id_remapping")
    assert resp.status_code == 404
    error = resp.json()["error"]
    assert error["code"] == "LOGIC_CODE_NOT_FOUND"
