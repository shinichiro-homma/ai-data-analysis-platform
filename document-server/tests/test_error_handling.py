"""exception_handler のユニットテスト。

タスク 9.3: エラーレスポンス機構の統一
- RequestValidationError -> 422 + {"error": {"code": "VALIDATION_ERROR", ...}} 形式
- generic Exception -> 500 + {"error": {"code": "INTERNAL_ERROR", ...}} 形式
- auth 401 は {"detail": ...} 形式を維持（回帰テスト）
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def test_request_validation_error_unified_format(client: TestClient) -> None:
    """空リスト送信で 422 + {"error": {"code": "VALIDATION_ERROR", ...}} 形式を検証。"""
    # Act: BulkNameList の min_length=1 に違反
    resp = client.post("/logic/meta", json={"logic_names": []})

    # Assert: 422 + 統一エラー形式
    assert resp.status_code == 422
    body = resp.json()
    assert "error" in body, f"Expected 'error' key in response, got: {body}"
    error = body["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert "message" in error
    assert isinstance(error["message"], str)
    assert len(error["message"]) > 0
    # FastAPI デフォルト形式 {"detail": [...]} ではないこと
    assert "detail" not in body


def test_generic_exception_returns_internal_error(
    sample_data_dir: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """意図的に Exception を発生させ 500 + 統一形式を検証。traceback が含まれないこと。"""
    from src.catalog_loader import CatalogStore
    from src.main import app

    # Arrange: 正常な状態を構築
    store = CatalogStore()
    store.load_tables(sample_data_dir)
    store.load_terms(sample_data_dir)
    store.load_logic(sample_data_dir)
    app.state.catalog_store = store
    app.state.last_reload = "2024-01-01T00:00:00+00:00"

    # catalog_store のメソッドで予期しない例外を発生させる
    def _raise_unexpected() -> None:
        raise RuntimeError("unexpected failure")

    monkeypatch.setattr(store, "get_all_logic_indexes", _raise_unexpected)

    # raise_server_exceptions=False で TestClient を作成
    # （例外が TestClient に伝播しないようにする）
    test_client = TestClient(app, raise_server_exceptions=False)
    test_client.headers.update({"Authorization": "Bearer test-token"})

    # Act
    resp = test_client.get("/logic/index")

    # Assert: 500 + 統一形式
    assert resp.status_code == 500
    body = resp.json()
    assert "error" in body, f"Expected 'error' key in response, got: {body}"
    error = body["error"]
    assert error["code"] == "INTERNAL_ERROR"
    assert "message" in error
    # traceback / exc 文字列がレスポンスに含まれないこと
    body_str = str(body)
    assert "traceback" not in body_str.lower()
    assert "unexpected failure" not in body_str


def test_catalog_load_error_does_not_leak_internal_details(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """カタログリロード失敗時にサーバー内部パスやYAML例外詳細がレスポンスに漏れないこと。"""
    import src.routers.admin as admin_module

    # Arrange: 壊れた YAML を持つデータディレクトリを作成
    broken_dir = tmp_path / "broken"
    broken_dir.mkdir()
    catalog_dir = broken_dir / "catalog"
    catalog_dir.mkdir()
    (catalog_dir / "index.yaml").write_text(
        "tables_index:\n  - {invalid yaml: [unterminated",
        encoding="utf-8",
    )

    monkeypatch.setattr(admin_module, "DATA_DIR", broken_dir)

    # Act: reload を実行（失敗を期待）
    resp = client.post("/admin/reload")

    # Assert: 400 + CATALOG_LOAD_ERROR
    assert resp.status_code == 400
    body = resp.json()
    assert "error" in body
    error = body["error"]
    assert error["code"] == "CATALOG_LOAD_ERROR"

    # セキュリティ: 内部詳細がレスポンスに漏れないこと
    msg = error["message"]
    assert "data/" not in msg, f"Internal path leaked in message: {msg}"
    assert "traceback" not in msg.lower(), f"Traceback leaked in message: {msg}"
    assert "yaml" not in msg.lower(), f"YAML parser details leaked in message: {msg}"
    assert "index.yaml" not in msg, f"Internal filename leaked in message: {msg}"
    assert tmp_path.name not in msg, f"Temp path leaked in message: {msg}"


def test_auth_401_format_unchanged() -> None:
    """auth の 401 レスポンスが {"detail": ...} 形式のままであること（回帰）。"""
    from src.main import app

    # 認証なしの TestClient（auth 依存が先に発火するため catalog state 不要）
    unauthenticated_client = TestClient(app)

    # Act: 認証ヘッダーなしでアクセス
    resp = unauthenticated_client.get("/catalog/index")

    # Assert: HTTPException の {"detail": "..."} 形式が維持されること
    assert resp.status_code == 401
    body = resp.json()
    assert "detail" in body
    # 統一エラー形式に巻き込まれていないこと
    assert "error" not in body
