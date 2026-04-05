"""Bearer token authentication tests for document-server."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import AUTH_HEADERS, TEST_TOKEN

# Endpoints that should require authentication.
PROTECTED_ENDPOINTS: list[tuple[str, str, dict | None]] = [
    ("GET", "/catalog/index", None),
    ("POST", "/catalog/tables", {"table_names": ["test_table"]}),
    ("GET", "/glossary/index", None),
    ("POST", "/glossary/terms", {"term_names": ["ロイヤルティランク"]}),
    ("GET", "/logic/index", None),
    ("POST", "/logic/meta", {"logic_names": ["member_id_remapping"]}),
]


class TestAuthNegative:
    """Requests with missing or invalid credentials must be rejected with 401."""

    def test_missing_authorization_header_returns_401(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/catalog/index")
        assert resp.status_code == 401

    def test_wrong_token_returns_401(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get(
            "/catalog/index",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401

    def test_non_bearer_scheme_returns_401(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get(
            "/catalog/index",
            headers={"Authorization": f"Basic {TEST_TOKEN}"},
        )
        assert resp.status_code == 401

    def test_missing_bearer_prefix_returns_401(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get(
            "/catalog/index",
            headers={"Authorization": TEST_TOKEN},
        )
        assert resp.status_code == 401

    def test_empty_bearer_token_returns_401(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get(
            "/catalog/index",
            headers={"Authorization": "Bearer "},
        )
        assert resp.status_code == 401

    def test_401_response_does_not_leak_token(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get(
            "/catalog/index",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert resp.status_code == 401
        body_text = resp.text
        assert TEST_TOKEN not in body_text
        assert "wrong-token" not in body_text


class TestAuthPositive:
    """Requests with valid Bearer token should reach the endpoint."""

    def test_valid_token_allows_catalog_index(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/catalog/index", headers=AUTH_HEADERS)
        assert resp.status_code == 200

    def test_valid_token_allows_glossary_index(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/glossary/index", headers=AUTH_HEADERS)
        assert resp.status_code == 200

    def test_valid_token_allows_logic_index(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/logic/index", headers=AUTH_HEADERS)
        assert resp.status_code == 200

    def test_valid_token_allows_post_endpoints(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.post(
            "/catalog/tables",
            json={"table_names": ["test_table"]},
            headers=AUTH_HEADERS,
        )
        assert resp.status_code == 200


class TestHealthExempt:
    """/health must be accessible without authentication (Docker healthcheck)."""

    def test_health_without_token_returns_200(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/health")
        assert resp.status_code == 200

    def test_health_with_token_returns_200(self, unauthed_client: TestClient) -> None:
        resp = unauthed_client.get("/health", headers=AUTH_HEADERS)
        assert resp.status_code == 200


class TestProtectedEndpoints:
    """Parameterized-ish check that all protected endpoints reject unauthed calls."""

    def test_all_protected_endpoints_require_auth(self, unauthed_client: TestClient) -> None:
        for method, path, body in PROTECTED_ENDPOINTS:
            resp = unauthed_client.get(path) if method == "GET" else unauthed_client.post(path, json=body)
            assert resp.status_code == 401, f"{method} {path} should require auth"
