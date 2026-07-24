from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_table_index(client: TestClient) -> None:
    resp = client.get("/catalog/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert len(data["tables"]) == 1
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["display_name"] == "テストテーブル"
    assert t["summary"] == "テスト用テーブル"
    assert t["category"] == "テスト系"


def test_get_table_details_single(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["test_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["not_found"] == []
    t = data["tables"][0]
    assert t["table_name"] == "test_table"
    assert t["description"] == "テスト用の説明文です。"
    assert t["data_source"]["type"] == "postgresql"
    assert len(t["columns"]) == 2
    assert t["columns"][0]["name"] == "id"


def test_get_table_details_multiple(client_full: TestClient) -> None:
    resp = client_full.post("/catalog/tables", json={"table_names": ["test_table", "full_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 2
    assert data["not_found"] == []


def test_get_table_details_partial_not_found(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["test_table", "nonexistent"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 1
    assert data["tables"][0]["table_name"] == "test_table"
    assert data["not_found"] == ["nonexistent"]


def test_get_table_details_all_not_found(client: TestClient) -> None:
    resp = client.post("/catalog/tables", json={"table_names": ["nonexistent"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["tables"]) == 0
    assert data["not_found"] == ["nonexistent"]


def test_get_table_details_full(client_full: TestClient) -> None:
    resp = client_full.post("/catalog/tables", json={"table_names": ["full_table"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    t = data["tables"][0]

    assert t["statistics"]["row_count"] == 1000
    assert t["statistics"]["date_range"]["from"] == "2024-01-01"
    assert t["statistics"]["date_range"]["to"] == "2024-12-31"
    assert t["statistics"]["update_frequency"] == "月次"

    assert len(t["notes_table_level"]) == 2

    col_code = t["columns"][0]
    assert col_code["key_type"] == "テストコード"
    assert col_code["domain"]["master_table"] == "master"
    assert col_code["examples"] == ["A001", "B002"]

    col_status = next(c for c in t["columns"] if c["name"] == "status")
    assert col_status["domain"]["values"] == ["active", "inactive"]


def test_get_table_details_key_types(client_full: TestClient) -> None:
    """key_types 配列がレスポンスに含まれること。"""
    resp = client_full.post("/catalog/tables", json={"table_names": ["full_table"]})
    assert resp.status_code == 200
    t = resp.json()["data"]["tables"][0]
    col_member = next(c for c in t["columns"] if c["name"] == "member_code")
    assert "key_types" in col_member
    assert len(col_member["key_types"]) == 2
    assert col_member["key_types"][0]["value"] == "統合会員番号"
    assert col_member["key_types"][0]["condition"] == "member_type = '正会員'"
    assert col_member["key_type"] is None


def test_get_table_details_key_type_only(client_full: TestClient) -> None:
    """key_type のみのカラムでは key_types が None であること。"""
    resp = client_full.post("/catalog/tables", json={"table_names": ["full_table"]})
    assert resp.status_code == 200
    t = resp.json()["data"]["tables"][0]
    col_code = next(c for c in t["columns"] if c["name"] == "code")
    assert col_code["key_type"] == "テストコード"
    assert col_code["key_types"] is None


def test_get_table_details_statistics_additional(client_full: TestClient) -> None:
    """statistics.additional にカスタム統計項目が含まれること。"""
    resp = client_full.post("/catalog/tables", json={"table_names": ["full_table"]})
    assert resp.status_code == 200
    t = resp.json()["data"]["tables"][0]
    additional = t["statistics"]["additional"]
    assert additional["avg_basket_size"] == 3.2
    assert additional["top_categories"] == ["食品", "日用品", "衣料"]
    assert additional["cancelled_rate"] == 0.05


def test_get_table_details_statistics_additional_empty(client: TestClient) -> None:
    """統計情報のないテーブルでは statistics が null であること。"""
    resp = client.post("/catalog/tables", json={"table_names": ["test_table"]})
    assert resp.status_code == 200
    t = resp.json()["data"]["tables"][0]
    assert t["statistics"] is None
