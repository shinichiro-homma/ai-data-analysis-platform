from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_term_index(client: TestClient) -> None:
    resp = client.get("/glossary/index")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 3
    assert len(data["terms"]) == 3
    names = {t["name"] for t in data["terms"]}
    assert "ロイヤルティランク" in names
    assert "統合会員ID" in names
    assert "店舗" in names


def test_get_term_details(client: TestClient) -> None:
    resp = client.post("/glossary/terms", json={"term_names": ["ロイヤルティランク"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["terms"]) == 1
    assert data["not_found"] == []
    term = data["terms"][0]
    assert term["name"] == "ロイヤルティランク"
    assert "ロイヤルティランク" in term["aliases"]
    assert term["definition"] == "統合会員の購買実績に基づく顧客ロイヤルティランク。"
    assert term["related_terms"] == ["統合会員ID"]


def test_get_term_details_with_values(client: TestClient) -> None:
    resp = client.post("/glossary/terms", json={"term_names": ["ロイヤルティランク"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    term = data["terms"][0]
    assert term["values"] is not None
    assert len(term["values"]) == 2
    assert term["values"][0]["label"] == "レギュラー"
    assert term["values"][0]["description"] == "基本ランク"


def test_get_term_details_without_values(client: TestClient) -> None:
    resp = client.post("/glossary/terms", json={"term_names": ["店舗"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    term = data["terms"][0]
    assert term["values"] is None


def test_get_term_details_partial_not_found(client: TestClient) -> None:
    resp = client.post(
        "/glossary/terms",
        json={"term_names": ["ロイヤルティランク", "存在しない用語"]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["terms"]) == 1
    assert data["terms"][0]["name"] == "ロイヤルティランク"
    assert data["not_found"] == ["存在しない用語"]


def test_get_term_details_all_not_found(client: TestClient) -> None:
    resp = client.post(
        "/glossary/terms",
        json={"term_names": ["存在しない用語"]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["terms"]) == 0
    assert data["not_found"] == ["存在しない用語"]


def test_get_term_details_empty_term_names(client: TestClient) -> None:
    resp = client.post("/glossary/terms", json={"term_names": []})
    assert resp.status_code == 422


def test_get_term_index_with_query_name_match(client: TestClient) -> None:
    """query で name に部分一致する用語が返る。"""
    resp = client.get("/glossary/index", params={"query": "ロイヤルティ"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["terms"][0]["name"] == "ロイヤルティランク"


def test_get_term_index_with_query_alias_match(client: TestClient) -> None:
    """query で aliases に部分一致する用語が返る。"""
    resp = client.get("/glossary/index", params={"query": "Loyalty"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 1
    assert data["terms"][0]["name"] == "ロイヤルティランク"


def test_get_term_index_with_query_no_match(client: TestClient) -> None:
    """query でヒットなしの場合は空配列が返る。"""
    resp = client.get("/glossary/index", params={"query": "存在しない用語"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["total"] == 0
    assert data["terms"] == []


def test_get_term_index_with_query_related_term_match(client: TestClient) -> None:
    """query で related_terms に部分一致する用語が返る。"""
    resp = client.get("/glossary/index", params={"query": "統合会員ID"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    names = {t["name"] for t in data["terms"]}
    # 「ロイヤルティランク」は related_terms に「統合会員ID」を含むのでヒットする
    assert "ロイヤルティランク" in names


def test_get_term_index_with_query_case_insensitive(client: TestClient) -> None:
    """query は大文字小文字を区別しない。"""
    resp_lower = client.get("/glossary/index", params={"query": "loyalty rank"})
    resp_upper = client.get("/glossary/index", params={"query": "LOYALTY RANK"})
    assert resp_lower.status_code == 200
    assert resp_upper.status_code == 200
    data_lower = resp_lower.json()["data"]
    data_upper = resp_upper.json()["data"]
    assert data_lower["total"] == data_upper["total"]
    assert data_lower["total"] >= 1
