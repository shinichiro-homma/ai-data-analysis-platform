"""ノートブックロックのサーバー側強制テスト（タスク 21.2）

テスト対象:
1. notebook_locks.py（ロックストア）
   - acquire: 成功して {token, expires_at} を返す / 競合時に None
   - release: 所有者トークン検証（正トークンで解放、不正トークンで拒否）
   - renew: 正トークンで expires_at 延長、不正トークンで None
   - get_locks: 現在のロック一覧
   - sweep_expired: 失効したエントリの path を返して除去する
   - TTL 失効: expires_at を過ぎたロックは失効扱い
   - ContextVar lock_token_ctx の存在と get/set

2. __init__.py の contents_manager.save ラップ（強制）
   - ロック中 + トークン不一致（ContextVar 未設定）の .ipynb save → HTTPError(423)
   - ロック中 + 正トークンの save → 委譲成功
   - 非ロックパスの save → 委譲成功
   - .ipynb 以外のパスはロック中でも検査対象外（貫通）

いずれの機能も未実装のため（TDD Red フェーズ）、モジュール/関数の存在確認と
振る舞いのテストを行う。実装が入るまで失敗する。
"""

import contextvars
import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


def _ensure_mock_module(name: str, **attrs) -> _types.ModuleType:
    """sys.modules にモックモジュールを登録（未登録の場合のみ）"""
    if name not in sys.modules:
        mod = _types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


def _load_module(name: str, filename: str) -> _types.ModuleType:
    """extensions/custom_api/ 配下のモジュールをファイルからロード"""
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


# notebook_locks.py は純粋モジュール（外部依存なし）
notebook_locks = _load_module("custom_api.notebook_locks", "notebook_locks.py")


@pytest.fixture(autouse=True)
def _clear_locks():
    """各テストの前後でロックストアをクリアする"""
    if hasattr(notebook_locks, "clear_all"):
        notebook_locks.clear_all()
    yield
    if hasattr(notebook_locks, "clear_all"):
        notebook_locks.clear_all()


# =============================================================================
# 1. ロックストア: acquire
# =============================================================================


class TestAcquire:
    """acquire の正常系・競合"""

    def test_acquire_returns_token_and_expiry(self):
        """acquire は token と expires_at を返す"""
        path = "workspaces/sample/ws-001/test.ipynb"
        result = notebook_locks.acquire(path, ttl=60)

        assert result is not None
        assert "token" in result
        assert isinstance(result["token"], str)
        assert len(result["token"]) > 0
        assert "expires_at" in result

    def test_acquire_conflict_returns_none(self):
        """同一パスの二重 acquire は None（先勝ち）"""
        path = "workspaces/sample/ws-001/test.ipynb"
        first = notebook_locks.acquire(path, ttl=60)
        assert first is not None

        second = notebook_locks.acquire(path, ttl=60)
        assert second is None

    def test_acquire_different_paths_both_succeed(self):
        """異なるパスは並行して acquire できる"""
        a = notebook_locks.acquire("workspaces/sample/ws-001/a.ipynb", ttl=60)
        b = notebook_locks.acquire("workspaces/sample/ws-001/b.ipynb", ttl=60)
        assert a is not None
        assert b is not None
        assert a["token"] != b["token"]

    def test_acquire_tokens_are_unique(self):
        """各 acquire は一意なトークンを発行する"""
        t1 = notebook_locks.acquire("workspaces/sample/ws-001/a.ipynb", ttl=60)["token"]
        t2 = notebook_locks.acquire("workspaces/sample/ws-001/b.ipynb", ttl=60)["token"]
        assert t1 != t2


# =============================================================================
# 2. ロックストア: release（所有者検証）
# =============================================================================


class TestRelease:
    """release の所有者トークン検証"""

    def test_release_with_correct_token_succeeds(self):
        """正しいトークンで解放できる"""
        path = "workspaces/sample/ws-001/test.ipynb"
        token = notebook_locks.acquire(path, ttl=60)["token"]

        released = notebook_locks.release(path, token)
        assert released is True

        # 解放後は再取得できる
        assert notebook_locks.acquire(path, ttl=60) is not None

    def test_release_with_wrong_token_fails(self):
        """不正なトークンでは解放できない"""
        path = "workspaces/sample/ws-001/test.ipynb"
        notebook_locks.acquire(path, ttl=60)

        released = notebook_locks.release(path, "wrong-token")
        assert released is False

        # ロックは維持されている（再取得できない）
        assert notebook_locks.acquire(path, ttl=60) is None

    def test_release_nonexistent_path_returns_false(self):
        """未ロックのパスの release は False（例外を投げない）"""
        released = notebook_locks.release("workspaces/sample/ws-001/none.ipynb", "any-token")
        assert released is False


# =============================================================================
# 3. ロックストア: renew（TTL 延長）
# =============================================================================


class TestRenew:
    """renew の正常系・所有者検証"""

    def test_renew_with_correct_token_extends_expiry(self):
        """正しいトークンで expires_at を延長できる"""
        path = "workspaces/sample/ws-001/test.ipynb"
        acquired = notebook_locks.acquire(path, ttl=1)
        token = acquired["token"]

        renewed = notebook_locks.renew(path, token, ttl=60)
        assert renewed is not None
        # 延長後の expires_at は元より後
        assert renewed["expires_at"] > acquired["expires_at"]

    def test_renew_with_wrong_token_fails(self):
        """不正なトークンでは renew できない"""
        path = "workspaces/sample/ws-001/test.ipynb"
        notebook_locks.acquire(path, ttl=60)

        renewed = notebook_locks.renew(path, "wrong-token", ttl=60)
        assert renewed is None

    def test_renew_nonexistent_path_returns_none(self):
        """未ロックのパスの renew は None"""
        renewed = notebook_locks.renew("workspaces/sample/ws-001/none.ipynb", "any", ttl=60)
        assert renewed is None


# =============================================================================
# 4. ロックストア: TTL 失効 / sweep_expired
# =============================================================================


class TestExpiry:
    """TTL 失効と sweep_expired"""

    def test_expired_lock_can_be_reacquired(self):
        """TTL を過ぎたロックは失効し、同一パスを再取得できる"""
        path = "workspaces/sample/ws-001/test.ipynb"
        # 過去に失効する TTL でロック（0 以下 or 極小）
        notebook_locks.acquire(path, ttl=0)

        # now を明示的に未来にして sweep すると失効エントリが返る
        future = notebook_locks.now() + 10
        expired = notebook_locks.sweep_expired(now=future)
        assert path in expired

        # 失効後は再取得できる
        assert notebook_locks.acquire(path, ttl=60) is not None

    def test_sweep_expired_returns_only_expired_paths(self):
        """sweep_expired は失効した path のみ返す"""
        short = "workspaces/sample/ws-001/short.ipynb"
        long = "workspaces/sample/ws-001/long.ipynb"
        notebook_locks.acquire(short, ttl=1)
        notebook_locks.acquire(long, ttl=600)

        # short だけが失効するタイミングで sweep
        after_short = notebook_locks.now() + 5
        expired = notebook_locks.sweep_expired(now=after_short)

        assert short in expired
        assert long not in expired

    def test_sweep_expired_removes_expired_entries(self):
        """sweep_expired は失効エントリをストアから除去する"""
        path = "workspaces/sample/ws-001/test.ipynb"
        notebook_locks.acquire(path, ttl=1)

        notebook_locks.sweep_expired(now=notebook_locks.now() + 5)

        locks = notebook_locks.get_locks()
        assert path not in locks


# =============================================================================
# 5. ロックストア: get_locks / ContextVar
# =============================================================================


class TestGetLocksAndContextVar:
    """get_locks とロックトークン ContextVar"""

    def test_get_locks_reflects_active_locks(self):
        """get_locks は現在有効なロックを返す"""
        path = "workspaces/sample/ws-001/test.ipynb"
        notebook_locks.acquire(path, ttl=60)

        locks = notebook_locks.get_locks()
        assert path in locks

    def test_lock_token_ctx_is_context_var(self):
        """lock_token_ctx は ContextVar である"""
        assert hasattr(notebook_locks, "lock_token_ctx")
        assert isinstance(notebook_locks.lock_token_ctx, contextvars.ContextVar)

    def test_lock_token_ctx_default_is_none(self):
        """lock_token_ctx の未設定時のデフォルトは None"""
        assert notebook_locks.lock_token_ctx.get() is None


# =============================================================================
# 6. save ラップによる強制（__init__.py）
# =============================================================================


def _load_init_module():
    """__init__.py を _wrap_contents_save 参照用にロードする。

    tests/conftest.py の setup_custom_api_init が custom_api.__init__ を
    ロード済みにしている前提で、そのモジュールを返す。
    """
    from custom_api import __init__ as init_module

    return init_module


class TestSaveWrapEnforcement:
    """contents_manager.save ラップによるロック強制（不変条件 I2）"""

    @pytest.mark.asyncio
    async def test_locked_notebook_without_token_raises_423(self):
        """ロック中 + トークンなしの .ipynb save は HTTPError(423)"""
        init_module = _load_init_module()
        assert hasattr(init_module, "_wrap_contents_save"), "_wrap_contents_save is not yet implemented in __init__.py"

        path = "workspaces/sample/ws-001/locked.ipynb"
        notebook_locks.acquire(path, ttl=60)

        original_save = AsyncMock()
        wrapped = init_module._wrap_contents_save(original_save)

        # ContextVar 未設定（トークンなし）で save → 423
        notebook_locks.lock_token_ctx.set(None)
        with pytest.raises(Exception) as exc_info:
            await wrapped({"type": "notebook"}, path)

        # tornado.web.HTTPError の status_code が 423
        assert getattr(exc_info.value, "status_code", None) == 423
        original_save.assert_not_called()

    @pytest.mark.asyncio
    async def test_locked_notebook_with_correct_token_succeeds(self):
        """ロック中 + 正トークンの save は委譲される"""
        init_module = _load_init_module()
        assert hasattr(init_module, "_wrap_contents_save")

        path = "workspaces/sample/ws-001/locked.ipynb"
        token = notebook_locks.acquire(path, ttl=60)["token"]

        original_save = AsyncMock(return_value={"ok": True})
        wrapped = init_module._wrap_contents_save(original_save)

        notebook_locks.lock_token_ctx.set(token)
        result = await wrapped({"type": "notebook"}, path)

        original_save.assert_awaited_once()
        assert result == {"ok": True}

    @pytest.mark.asyncio
    async def test_unlocked_notebook_save_succeeds(self):
        """未ロックの .ipynb save は委譲される"""
        init_module = _load_init_module()
        assert hasattr(init_module, "_wrap_contents_save")

        path = "workspaces/sample/ws-001/free.ipynb"
        original_save = AsyncMock(return_value={"ok": True})
        wrapped = init_module._wrap_contents_save(original_save)

        notebook_locks.lock_token_ctx.set(None)
        result = await wrapped({"type": "notebook"}, path)

        original_save.assert_awaited_once()
        assert result == {"ok": True}

    @pytest.mark.asyncio
    async def test_non_notebook_path_bypasses_lock_check(self):
        """.ipynb 以外のパスはロック中でも検査対象外（貫通）"""
        init_module = _load_init_module()
        assert hasattr(init_module, "_wrap_contents_save")

        # 同名 stem の .ipynb をロックしても、別拡張子の save には影響しない
        data_path = "workspaces/sample/ws-001/data.csv"
        original_save = AsyncMock(return_value={"ok": True})
        wrapped = init_module._wrap_contents_save(original_save)

        notebook_locks.lock_token_ctx.set(None)
        result = await wrapped({"type": "file"}, data_path)

        original_save.assert_awaited_once()
        assert result == {"ok": True}


# =============================================================================
# 7. TTL バリデーション（バグ 3）: ttl=0 / 負値 / 上限クランプ
# =============================================================================


def _load_lock_handlers() -> _types.ModuleType:
    """lock_handlers.py をロードする（tornado.web / base / ai_events をモック）。"""
    for _mod_name in ("tornado", "tornado.web"):
        if _mod_name not in sys.modules:
            _m = _types.ModuleType(_mod_name)
            if _mod_name == "tornado.web":
                _m.authenticated = lambda f: f
            sys.modules[_mod_name] = _m

    if "custom_api.base" not in sys.modules:
        _base_mock = _types.ModuleType("custom_api.base")
        _base_mock.__package__ = "custom_api"
        _base_mock.BaseCustomHandler = type("BaseCustomHandler", (), {})
        sys.modules["custom_api.base"] = _base_mock

    # ai_events は conftest 等で既に登録済みの場合があるため、
    # broadcast_event（lock_handlers が遅延インポートする）を確実に生やす。
    if "custom_api.ai_events" not in sys.modules:
        _ai_mock = _types.ModuleType("custom_api.ai_events")
        _ai_mock.__package__ = "custom_api"
        sys.modules["custom_api.ai_events"] = _ai_mock
    sys.modules["custom_api.ai_events"].broadcast_event = lambda event: None

    # notebook_locks は本テストが既にロード済みのインスタンスを共有させる
    sys.modules["custom_api.notebook_locks"] = notebook_locks

    return _load_module("custom_api.lock_handlers", "lock_handlers.py")


lock_handlers = _load_lock_handlers()


def _make_lock_handler(body: dict):
    """NotebookLocksHandler のモックを作成する。"""
    handler = MagicMock(spec=lock_handlers.NotebookLocksHandler)
    handler.get_json_body = MagicMock(return_value=body)

    responses = []
    handler.write_success = MagicMock(side_effect=lambda d: responses.append(("success", d)))
    handler.write_error_response = MagicMock(
        side_effect=lambda code, msg, status: responses.append(("error", code, msg, status))
    )
    handler._responses = responses
    return handler


class TestTtlValidation:
    """POST/PUT の ttl バリデーション（バグ 3: ttl<1 の受理を防ぐ）"""

    @pytest.mark.asyncio
    async def test_post_rejects_ttl_zero(self):
        """ttl=0 は 400 VALIDATION_ERROR"""
        handler = _make_lock_handler({"notebook_path": "workspaces/sample/ws-001/test.ipynb", "ttl": 0})
        await lock_handlers.NotebookLocksHandler.post(handler)

        assert handler._responses == [("error", "VALIDATION_ERROR", handler._responses[0][2], 400)]

    @pytest.mark.asyncio
    async def test_post_rejects_negative_ttl(self):
        """ttl=-1 は 400 VALIDATION_ERROR"""
        handler = _make_lock_handler({"notebook_path": "workspaces/sample/ws-001/test.ipynb", "ttl": -1})
        await lock_handlers.NotebookLocksHandler.post(handler)

        assert handler._responses[0][0] == "error"
        assert handler._responses[0][1] == "VALIDATION_ERROR"
        assert handler._responses[0][3] == 400

    @pytest.mark.asyncio
    async def test_post_clamps_ttl_to_max(self):
        """ttl=700 は 600 にクランプされて成功する"""
        handler = _make_lock_handler({"notebook_path": "workspaces/sample/ws-001/test.ipynb", "ttl": 700})
        base = notebook_locks.now()
        await lock_handlers.NotebookLocksHandler.post(handler)

        assert handler._responses[0][0] == "success"
        expires_at = handler._responses[0][1]["expires_at"]
        # 上限 600 でクランプ（多少の実行時間を許容）
        assert expires_at <= base + notebook_locks.MAX_TTL + 1

    @pytest.mark.asyncio
    async def test_put_rejects_ttl_zero(self):
        """PUT でも ttl=0 は 400 VALIDATION_ERROR"""
        path = "workspaces/sample/ws-001/test.ipynb"
        token = notebook_locks.acquire(path, ttl=60)["token"]
        handler = _make_lock_handler({"notebook_path": path, "lock_token": token, "ttl": 0})
        await lock_handlers.NotebookLocksHandler.put(handler)

        assert handler._responses[0][0] == "error"
        assert handler._responses[0][1] == "VALIDATION_ERROR"
        assert handler._responses[0][3] == 400


# =============================================================================
# 8. パス正規化（バグ 2）: 先頭スラッシュの正規化でロックキーを統一する
# =============================================================================


class TestLockPathNormalization:
    """先頭スラッシュ付きパスでも save 検査パスと同一のロックキーになる（バグ 2）"""

    @pytest.mark.asyncio
    async def test_acquire_with_leading_slash_protects_normalized_save(self):
        """/ws/x.ipynb で acquire したロックが ws/x.ipynb の save を保護する"""
        notebook_locks.clear_all()
        handler = _make_lock_handler({"notebook_path": "/workspaces/sample/ws-001/slash-test.ipynb", "ttl": 60})
        await lock_handlers.NotebookLocksHandler.post(handler)
        assert handler._responses[0][0] == "success", f"unexpected response: {handler._responses}"

        # 正規化済みキー（先頭スラッシュなし）でロックが引ける。
        # ハンドラーが実際に参照するストア（lock_handlers.notebook_locks）で検証し、
        # save 検査（_wrap_contents_save 経由の同一ストア）と同一キーになることを保証する。
        normalized = "workspaces/sample/ws-001/slash-test.ipynb"
        assert lock_handlers.notebook_locks.get_lock_token(normalized) is not None

    def test_validate_lock_path_returns_normalized_path(self):
        """_validate_lock_path は先頭スラッシュを除去した正規化パスを返す"""
        normalized, error = lock_handlers._validate_lock_path("/workspaces/sample/ws-001/test.ipynb")
        assert error is None
        assert normalized == "workspaces/sample/ws-001/test.ipynb"

    def test_validate_lock_path_rejects_non_notebook(self):
        """.ipynb 以外はエラー"""
        normalized, error = lock_handlers._validate_lock_path("/workspaces/sample/ws-001/data.csv")
        assert error is not None


# =============================================================================
# 9. スイーパータスクの参照保持（バグ 4）
# =============================================================================


class TestSweeperTaskReference:
    """_lock_sweeper_loop タスクへの強参照が保持される（バグ 4: GC 回収防止）"""

    def test_sweeper_task_reference_is_retained(self):
        """拡張ロード後、スイーパータスクへの参照がモジュールに保持されている"""
        from custom_api import __init__ as init_module

        assert hasattr(init_module, "_lock_sweeper_task"), (
            "_lock_sweeper_task 参照が __init__.py に存在しない（GC で回収され得る）"
        )
