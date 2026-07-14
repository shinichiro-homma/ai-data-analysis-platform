"""sync_state API のユニットテスト（タスク 21.4: 再接続時の再同期）

テスト対象:
1. get_sync_state_payload() — sync_state.py に追加予定
   - 空状態でのペイロード構造
   - seq ストア反映
   - アクティブロック反映（token キーを含まない）
   - 失効ロック除外

2. SyncStateHandler — handlers.py に追加予定
   - @web.authenticated が付与されていること
   - /api/ai/sync-state ルートが get_handlers に登録されていること

3. broadcast_event — ai_events.py の既存関数
   - write_message 失敗時にクライアントを除去し close() を呼ぶこと
   - 1 クライアント失敗でも他クライアントへ配信が継続すること
"""

import importlib.util
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


def _ensure_mock_module(name: str, **attrs) -> _types.ModuleType:
    """sys.modules にモックモジュールを登録（未登録の場合のみ）"""
    if name not in sys.modules:
        mod = _types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


# custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg


# _load_module_fresh で上書きする sys.modules エントリを退避
_saved_modules = {}
for _mod_name in ("custom_api.sync_state", "custom_api.notebook_locks", "custom_api.ai_events"):
    if _mod_name in sys.modules:
        _saved_modules[_mod_name] = sys.modules[_mod_name]

# sync_state, notebook_locks モジュールをファイルからロード（本テスト専用インスタンス）
sync_state = _load_module_fresh("custom_api.sync_state", "sync_state.py")
notebook_locks = _load_module_fresh("custom_api.notebook_locks", "notebook_locks.py")

# 即座に sys.modules を復元（他テストファイルの module-level 参照を汚染しない）
for _mod_name, _mod in _saved_modules.items():
    sys.modules[_mod_name] = _mod
for _mod_name in ("custom_api.sync_state", "custom_api.notebook_locks", "custom_api.ai_events"):
    if _mod_name not in _saved_modules:
        sys.modules.pop(_mod_name, None)


@pytest.fixture(autouse=True)
def _setup_and_clear_state():
    """各テストで sys.modules を本テスト用インスタンスに差し替え、終了後に復元する。

    get_sync_state_payload() の lazy import が本テスト用の notebook_locks を参照するために必要。
    """
    sys.modules["custom_api.sync_state"] = sync_state
    sys.modules["custom_api.notebook_locks"] = notebook_locks
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()
    if hasattr(notebook_locks, "clear_all"):
        notebook_locks.clear_all()
    yield
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()
    if hasattr(notebook_locks, "clear_all"):
        notebook_locks.clear_all()
    for mod_name, mod in _saved_modules.items():
        sys.modules[mod_name] = mod
    for mod_name in ("custom_api.sync_state", "custom_api.notebook_locks", "custom_api.ai_events"):
        if mod_name not in _saved_modules:
            sys.modules.pop(mod_name, None)


# =============================================================================
# 1. get_sync_state_payload のテスト
# =============================================================================


class TestSyncStatePayload:
    """get_sync_state_payload() のテスト"""

    def test_payload_empty_when_no_state(self):
        """seq・ロックなしで {"notebooks": {}, "locks": []}"""
        assert hasattr(sync_state, "get_sync_state_payload"), "sync_state.get_sync_state_payload 関数が存在すること"

        payload = sync_state.get_sync_state_payload()
        assert payload == {"notebooks": {}, "locks": []}

    def test_payload_reflects_seq_store(self):
        """next_seq 後に notebooks へ反映"""
        assert hasattr(sync_state, "get_sync_state_payload"), "sync_state.get_sync_state_payload 関数が存在すること"

        sync_state.next_seq("analysis.ipynb")
        sync_state.next_seq("analysis.ipynb")
        sync_state.next_seq("other.ipynb")

        payload = sync_state.get_sync_state_payload()
        assert payload["notebooks"] == {"analysis.ipynb": 2, "other.ipynb": 1}

    def test_payload_reflects_active_locks_without_token(self):
        """acquire 後に locks へ {notebook_path, expires_at} が入り、token キーが存在しない"""
        assert hasattr(sync_state, "get_sync_state_payload"), "sync_state.get_sync_state_payload 関数が存在すること"

        entry = notebook_locks.acquire("ws/test.ipynb", ttl=300)
        assert entry is not None, "ロック取得に成功すること"

        payload = sync_state.get_sync_state_payload()
        assert len(payload["locks"]) == 1

        lock = payload["locks"][0]
        assert "notebook_path" in lock
        assert "expires_at" in lock
        assert "token" not in lock, "token キーはレスポンスに含めない"

    def test_payload_excludes_expired_locks(self):
        """失効ロックは locks に含まれない"""
        assert hasattr(sync_state, "get_sync_state_payload"), "sync_state.get_sync_state_payload 関数が存在すること"

        # TTL=0 で即失効するロックを取得
        entry = notebook_locks.acquire("ws/expired.ipynb", ttl=0)
        assert entry is not None, "ロック取得に成功すること"

        payload = sync_state.get_sync_state_payload()
        # TTL=0 のロックは即失効するため、locks に含まれない
        assert len(payload["locks"]) == 0


# =============================================================================
# 2. SyncStateHandler のテスト（ソース検査）
# =============================================================================


class TestSyncStateHandler:
    """SyncStateHandler のハンドラー定義検証（ソース検査）"""

    def test_sync_state_handler_has_web_authenticated(self):
        """handlers.py のソース検査で SyncStateHandler.get に @web.authenticated"""
        handlers_path = _ext_dir / "custom_api" / "handlers.py"
        source = handlers_path.read_text(encoding="utf-8")

        # SyncStateHandler クラスの定義を探す
        assert "class SyncStateHandler" in source, "handlers.py に SyncStateHandler クラスが定義されていること"

        # SyncStateHandler.get に @web.authenticated が適用されていることを検証
        # ソースを行単位で走査し、class 定義後の get メソッドに
        # @web.authenticated デコレータがあることを確認する
        lines = source.split("\n")
        in_handler = False
        found_authenticated = False
        for line in lines:
            stripped = line.strip()
            if "class SyncStateHandler" in stripped:
                in_handler = True
                continue
            if in_handler:
                # 次のクラス定義に到達したら終了
                if stripped.startswith("class ") and "SyncStateHandler" not in stripped:
                    break
                if "@web.authenticated" in stripped:
                    found_authenticated = True
                if "def get(" in stripped and found_authenticated:
                    break

        assert found_authenticated, "SyncStateHandler.get に @web.authenticated デコレータが適用されていること"

    def test_sync_state_route_registered(self):
        """handlers.py のソース検査で /api/ai/sync-state が get_handlers に登録"""
        handlers_path = _ext_dir / "custom_api" / "handlers.py"
        source = handlers_path.read_text(encoding="utf-8")

        # get_handlers 関数内に /api/ai/sync-state ルートが登録されていることを確認
        assert "/api/ai/sync-state" in source, (
            "handlers.py の get_handlers に /api/ai/sync-state ルートが登録されていること"
        )

        # SyncStateHandler が関連付けられていることも確認
        # get_handlers 内のエントリは (url_pattern, HandlerClass) の形式
        assert "SyncStateHandler" in source, "handlers.py に SyncStateHandler への参照が存在すること"


# =============================================================================
# 3. broadcast_event の失敗クライアント除去テスト
# =============================================================================


class TestBroadcastFailedClientRemoval:
    """broadcast_event で write_message が失敗するクライアントの除去テスト"""

    def test_broadcast_removes_failed_client(self):
        """write_message が例外を投げるモッククライアントが
        _websocket_clients から除去され close() が呼ばれ、
        2 回目の broadcast の対象にならない"""
        # ai_events モジュールを再ロード
        ae = _load_module_fresh("custom_api.ai_events", "ai_events.py")

        # 失敗するクライアントを作成
        failed_client = MagicMock()
        failed_client.write_message.side_effect = Exception("connection lost")

        # _websocket_clients に登録
        ae._websocket_clients.add(failed_client)
        assert len(ae._websocket_clients) == 1

        # 1 回目の broadcast — 失敗クライアントが除去されるはず
        ae.broadcast_event({"type": "notebook_changed", "notebook_path": "test.ipynb", "seq": 1})

        # 失敗クライアントは除去されている
        assert failed_client not in ae._websocket_clients, (
            "write_message 失敗クライアントは _websocket_clients から除去されること"
        )
        # close() が呼ばれている
        failed_client.close.assert_called_once()

        # 2 回目の broadcast — 除去されたクライアントに配信されないことを確認
        failed_client.write_message.reset_mock()
        ae.broadcast_event({"type": "notebook_changed", "notebook_path": "test.ipynb", "seq": 2})

        # write_message は 2 回目に呼ばれない
        failed_client.write_message.assert_not_called()

        # クリーンアップ
        ae._websocket_clients.clear()

    def test_broadcast_continues_to_healthy_clients(self):
        """1 クライアント失敗でも他クライアントへ配信され戻り値のカウントが正しい"""
        # ai_events モジュールを再ロード
        ae = _load_module_fresh("custom_api.ai_events", "ai_events.py")

        # 失敗するクライアント
        failed_client = MagicMock()
        failed_client.write_message.side_effect = Exception("connection lost")

        # 正常なクライアント
        healthy_client = MagicMock()

        # _websocket_clients に登録
        ae._websocket_clients.add(failed_client)
        ae._websocket_clients.add(healthy_client)

        event = {"type": "notebook_changed", "notebook_path": "test.ipynb", "seq": 1}
        count = ae.broadcast_event(event)

        # 正常クライアントには配信された
        healthy_client.write_message.assert_called_once()
        # 戻り値は正常クライアントのカウント（1）
        assert count == 1, "成功した配信数が 1 であること"

        # 失敗クライアントは除去されている
        assert failed_client not in ae._websocket_clients
        # 正常クライアントは残っている
        assert healthy_client in ae._websocket_clients

        # クリーンアップ
        ae._websocket_clients.clear()
