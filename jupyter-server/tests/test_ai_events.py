"""AiEventsPostHandler の POST バリデーションテスト（Issue #89 Red フェーズ）

テスト対象:
1. ALLOWED_EVENT_TYPES 定数の存在と内容
2. type フィールドのバリデーション
   - allowlist 外の type → 400
   - type 欠落 → 400
   - type が非文字列 → 400
3. notebook_changed 固有フィールドのバリデーション
   - notebook_path 欠落 → 400
   - notebook_path が非文字列 → 400
   - seq 欠落 → 400
   - seq が非 int → 400
   - seq が bool → 400（bool は int のサブクラスだが除外する）
4. 正常な 5 種のイベント → 200 でブロードキャスト
5. BaseCustomHandler 継承への移行確認

修正前は全テストが FAIL する（検証なしで broadcast_event に渡すため）。
"""

import importlib.util
import json
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


def _load_module_fresh(name: str, filename: str) -> _types.ModuleType:
    """extensions/custom_api/ 配下のモジュールをファイルからロード（既存エントリを上書き）"""
    sys.modules.pop(name, None)
    path = _ext_dir / "custom_api" / filename
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# =============================================================================
# ai_events.py のロード
# 外部依存（tornado, jupyter_server）は実パッケージがインストール済みのため
# モック不要。custom_api.base は修正後に ai_events.py が import するため、
# ファイルから直接ロードしておく。
# =============================================================================

# custom_api.base をファイルからロード（修正後の from .base import BaseCustomHandler に対応）
if "custom_api.base" not in sys.modules:
    _load_module_fresh("custom_api.base", "base.py")

ai_events = _load_module_fresh("custom_api.ai_events", "ai_events.py")


# =========================================================================
# ハンドラーモック生成ヘルパー
# =========================================================================


def _make_post_handler(body: dict):
    """AiEventsPostHandler のモックインスタンスを作成する。

    write_error_response / finish / set_status をキャプチャし、
    レスポンスの検証を可能にする。
    """
    handler = MagicMock(spec=ai_events.AiEventsPostHandler)

    # リクエストボディ
    handler.request = MagicMock()
    handler.request.body = json.dumps(body).encode("utf-8")

    # レスポンスキャプチャ
    responses = []
    handler.write_error_response = MagicMock(
        side_effect=lambda code, msg, status=400: responses.append(("error", code, msg, status))
    )
    handler.finish = MagicMock(side_effect=lambda data=None: responses.append(("finish", data)))
    handler.set_status = MagicMock()

    # get_json_body（BaseCustomHandler 継承後に使用される想定）
    handler.get_json_body = MagicMock(return_value=body)

    handler._responses = responses
    return handler


# broadcast_event をモック差し替え
_broadcast_calls = []


@pytest.fixture(autouse=True)
def _mock_broadcast():
    """broadcast_event をキャプチャ用に差し替える"""
    _broadcast_calls.clear()
    original = ai_events.broadcast_event
    ai_events.broadcast_event = lambda event: _broadcast_calls.append(event) or 0
    yield
    ai_events.broadcast_event = original


# =========================================================================
# 1. ALLOWED_EVENT_TYPES 定数
# =========================================================================


class TestAllowedEventTypes:
    """ALLOWED_EVENT_TYPES 定数の存在と内容"""

    def test_constant_exists(self):
        """ALLOWED_EVENT_TYPES がモジュールに定義されている"""
        assert hasattr(ai_events, "ALLOWED_EVENT_TYPES"), "ai_events.ALLOWED_EVENT_TYPES 定数が存在しません"

    def test_contains_five_known_types(self):
        """5 種の既知イベント type を含む"""
        expected = {
            "notebook_changed",
            "cell_execute_start",
            "cell_execute_end",
            "lock_acquired",
            "lock_released",
        }
        actual = set(ai_events.ALLOWED_EVENT_TYPES)
        assert actual == expected, f"期待: {expected}, 実際: {actual}"


# =========================================================================
# 2. type フィールドのバリデーション → 400
# =========================================================================


class TestTypeValidation:
    """type フィールドの不正値に対して 400 を返す"""

    @pytest.mark.asyncio
    async def test_unknown_type_returns_400(self):
        """allowlist 外の type は 400"""
        handler = _make_post_handler({"type": "unknown_event"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error", f"エラーレスポンスが期待されるが: {resp}"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_missing_type_returns_400(self):
        """type 欠落は 400"""
        handler = _make_post_handler({"notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_non_string_type_returns_400(self):
        """type が文字列でなければ 400"""
        handler = _make_post_handler({"type": 123})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_null_type_returns_400(self):
        """type が null の場合は 400"""
        handler = _make_post_handler({"type": None})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_invalid_type_does_not_broadcast(self):
        """不正な type の場合、broadcast_event が呼ばれない"""
        handler = _make_post_handler({"type": "unknown_event"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 0, "不正な type でブロードキャストされてはならない"


# =========================================================================
# 3. notebook_changed 固有フィールドのバリデーション → 400
# =========================================================================


class TestNotebookChangedValidation:
    """notebook_changed イベントの必須フィールドバリデーション"""

    @pytest.mark.asyncio
    async def test_missing_notebook_path_returns_400(self):
        """notebook_path 欠落は 400"""
        handler = _make_post_handler({"type": "notebook_changed", "seq": 1})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_non_string_notebook_path_returns_400(self):
        """notebook_path が文字列でなければ 400"""
        handler = _make_post_handler({"type": "notebook_changed", "notebook_path": 123, "seq": 1})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_missing_seq_returns_400(self):
        """seq 欠落は 400"""
        handler = _make_post_handler({"type": "notebook_changed", "notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_non_int_seq_returns_400(self):
        """seq が int でなければ 400"""
        handler = _make_post_handler({"type": "notebook_changed", "notebook_path": "test.ipynb", "seq": "abc"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_bool_seq_returns_400(self):
        """seq が bool の場合は 400（bool は int のサブクラスだが除外する）"""
        handler = _make_post_handler({"type": "notebook_changed", "notebook_path": "test.ipynb", "seq": True})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_invalid_notebook_changed_does_not_broadcast(self):
        """不正な notebook_changed の場合、broadcast_event が呼ばれない"""
        handler = _make_post_handler({"type": "notebook_changed", "seq": 1})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 0, "不正な notebook_changed でブロードキャストされてはならない"


class TestCommonNotebookPathValidation:
    """全イベント種共通の notebook_path バリデーション"""

    @pytest.mark.asyncio
    async def test_cell_execute_start_missing_notebook_path_returns_400(self):
        """cell_execute_start で notebook_path 欠落は 400"""
        handler = _make_post_handler({"type": "cell_execute_start"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_cell_execute_start_non_string_notebook_path_returns_400(self):
        """cell_execute_start で notebook_path が非文字列は 400"""
        handler = _make_post_handler({"type": "cell_execute_start", "notebook_path": 123})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_lock_acquired_missing_notebook_path_returns_400(self):
        """lock_acquired で notebook_path 欠落は 400"""
        handler = _make_post_handler({"type": "lock_acquired"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_lock_released_missing_notebook_path_returns_400(self):
        """lock_released で notebook_path 欠落は 400"""
        handler = _make_post_handler({"type": "lock_released"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400


# =========================================================================
# 4. 正常な 5 種のイベント → 200 でブロードキャスト
# =========================================================================


class TestValidEvents:
    """正常なイベントが 200 でブロードキャストされる"""

    @pytest.mark.asyncio
    async def test_notebook_changed_success(self):
        """notebook_changed が正常にブロードキャストされる"""
        handler = _make_post_handler(
            {
                "type": "notebook_changed",
                "notebook_path": "analysis.ipynb",
                "seq": 1,
            }
        )
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 1
        assert _broadcast_calls[0]["type"] == "notebook_changed"
        # finish が呼ばれ、エラーレスポンスではない
        finish_calls = [r for r in handler._responses if r[0] == "finish"]
        error_calls = [r for r in handler._responses if r[0] == "error"]
        assert len(error_calls) == 0, f"エラーが発生: {error_calls}"
        assert len(finish_calls) >= 1

    @pytest.mark.asyncio
    async def test_cell_execute_start_success(self):
        """cell_execute_start が正常にブロードキャストされる"""
        handler = _make_post_handler({"type": "cell_execute_start", "notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 1
        assert _broadcast_calls[0]["type"] == "cell_execute_start"
        error_calls = [r for r in handler._responses if r[0] == "error"]
        assert len(error_calls) == 0

    @pytest.mark.asyncio
    async def test_cell_execute_end_success(self):
        """cell_execute_end が正常にブロードキャストされる"""
        handler = _make_post_handler({"type": "cell_execute_end", "notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 1
        assert _broadcast_calls[0]["type"] == "cell_execute_end"
        error_calls = [r for r in handler._responses if r[0] == "error"]
        assert len(error_calls) == 0

    @pytest.mark.asyncio
    async def test_lock_acquired_success(self):
        """lock_acquired が正常にブロードキャストされる"""
        handler = _make_post_handler({"type": "lock_acquired", "notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 1
        assert _broadcast_calls[0]["type"] == "lock_acquired"
        error_calls = [r for r in handler._responses if r[0] == "error"]
        assert len(error_calls) == 0

    @pytest.mark.asyncio
    async def test_lock_released_success(self):
        """lock_released が正常にブロードキャストされる"""
        handler = _make_post_handler({"type": "lock_released", "notebook_path": "test.ipynb"})
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(_broadcast_calls) == 1
        assert _broadcast_calls[0]["type"] == "lock_released"
        error_calls = [r for r in handler._responses if r[0] == "error"]
        assert len(error_calls) == 0


# =========================================================================
# 5. BaseCustomHandler 継承の確認
# =========================================================================


class TestBaseCustomHandlerInheritance:
    """AiEventsPostHandler が BaseCustomHandler を継承していることを検証"""

    def test_inherits_base_custom_handler(self):
        """AiEventsPostHandler のソースで BaseCustomHandler を継承していることを確認"""
        import re

        source_path = _ext_dir / "custom_api" / "ai_events.py"
        source = source_path.read_text(encoding="utf-8")

        class_match = re.search(
            r"class\s+AiEventsPostHandler\s*\(\s*(\w+)\s*\)",
            source,
        )
        assert class_match is not None, "AiEventsPostHandler クラスが見つかりません"

        parent_class = class_match.group(1)
        assert parent_class == "BaseCustomHandler", (
            f"AiEventsPostHandler は BaseCustomHandler を継承すべきですが、実際には {parent_class} を継承しています"
        )


# =========================================================================
# 6. JSON パースエラーの既存動作を維持
# =========================================================================


class TestJsonParseError:
    """不正な JSON の場合に 400 を返す（既存動作の回帰テスト）"""

    @pytest.mark.asyncio
    async def test_invalid_json_returns_400(self):
        """不正な JSON は 400"""
        handler = MagicMock(spec=ai_events.AiEventsPostHandler)
        handler.request = MagicMock()
        handler.request.body = b"not-valid-json"

        responses = []
        handler.write_error_response = MagicMock(
            side_effect=lambda code, msg, status=400: responses.append(("error", code, msg, status))
        )
        handler.finish = MagicMock(side_effect=lambda data=None: responses.append(("finish", data)))
        handler.set_status = MagicMock()
        handler.get_json_body = MagicMock(side_effect=Exception("invalid json"))
        handler._responses = responses

        await ai_events.AiEventsPostHandler.post(handler)

        # 400 が返されること（write_error_response 経由または set_status 経由）
        error_responses = [r for r in responses if r[0] == "error"]
        status_400 = handler.set_status.call_args_list

        has_400 = any(r[3] == 400 for r in error_responses) or any(
            call.args[0] == 400 for call in status_400 if call.args
        )
        assert has_400, "不正な JSON で 400 が返されること"


# =========================================================================
# 7. 非 dict JSON ボディのバリデーション → 400
# =========================================================================


def _make_post_handler_raw(raw_bytes: bytes):
    """AiEventsPostHandler のモックインスタンスを作成する（生バイト列版）。

    _make_post_handler と同じレスポンスキャプチャ構造だが、
    request.body に raw_bytes を直接セットする。
    json.dumps できない非 dict 値（配列・文字列・数値・null）のテストに使用。
    """
    handler = MagicMock(spec=ai_events.AiEventsPostHandler)

    # リクエストボディ（生バイト列を直接セット）
    handler.request = MagicMock()
    handler.request.body = raw_bytes

    # レスポンスキャプチャ
    responses = []
    handler.write_error_response = MagicMock(
        side_effect=lambda code, msg, status=400: responses.append(("error", code, msg, status))
    )
    handler.finish = MagicMock(side_effect=lambda data=None: responses.append(("finish", data)))
    handler.set_status = MagicMock()

    handler._responses = responses
    return handler


class TestNonDictJsonBody:
    """JSON オブジェクト以外のボディに対して 400 を返す"""

    @pytest.mark.asyncio
    async def test_json_array_returns_400(self):
        """JSON 配列は 400"""
        handler = _make_post_handler_raw(b"[1, 2, 3]")
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error", f"エラーレスポンスが期待されるが: {resp}"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_json_string_returns_400(self):
        """JSON 文字列は 400"""
        handler = _make_post_handler_raw(b'"hello"')
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_json_number_returns_400(self):
        """JSON 数値は 400"""
        handler = _make_post_handler_raw(b"123")
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400

    @pytest.mark.asyncio
    async def test_json_null_returns_400(self):
        """JSON null は 400"""
        handler = _make_post_handler_raw(b"null")
        await ai_events.AiEventsPostHandler.post(handler)

        assert len(handler._responses) >= 1
        resp = handler._responses[0]
        assert resp[0] == "error"
        assert resp[1] == "VALIDATION_ERROR"
        assert resp[3] == 400


# =========================================================================
# 8. 内部エラー時の情報漏洩防止
# =========================================================================


class TestInternalErrorHandling:
    """内部エラー時にエラー詳細がレスポンスに漏洩しない"""

    @pytest.mark.asyncio
    async def test_broadcast_exception_uses_write_error_response(self):
        """broadcast_event が例外を投げた場合、write_error_response が使われる"""
        handler = _make_post_handler({"type": "cell_execute_start", "notebook_path": "test.ipynb"})

        # broadcast_event を例外を投げるモックに差し替え
        original = ai_events.broadcast_event
        secret_msg = "secret database connection string leaked"
        ai_events.broadcast_event = MagicMock(side_effect=RuntimeError(secret_msg))
        try:
            await ai_events.AiEventsPostHandler.post(handler)
        finally:
            ai_events.broadcast_event = original

        # write_error_response("INTERNAL_ERROR", ...) が使われること
        error_responses = [r for r in handler._responses if r[0] == "error"]
        assert len(error_responses) >= 1, "write_error_response が呼ばれるべき"
        resp = error_responses[0]
        assert resp[1] == "INTERNAL_ERROR"
        assert resp[3] == 500

        # str(e) の内容がレスポンスメッセージに含まれないこと
        assert secret_msg not in resp[2], f"内部エラーの詳細がレスポンスに漏洩している: {resp[2]}"

        # finish が直接呼ばれていないこと（set_status + finish の独自フォーマットでないこと）
        finish_responses = [r for r in handler._responses if r[0] == "finish"]
        for fr in finish_responses:
            if fr[1] is not None:
                assert secret_msg not in fr[1], f"内部エラーの詳細が finish レスポンスに漏洩している: {fr[1]}"
