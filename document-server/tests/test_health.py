from __future__ import annotations

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"
    assert data["version"] == "1.0.0"
    assert "catalog" in data
    assert isinstance(data["catalog"]["tables"], int)
    assert data["catalog"]["terms"] == 3
    assert data["catalog"]["logic"] == 2
    assert "last_reload" in data["catalog"]
