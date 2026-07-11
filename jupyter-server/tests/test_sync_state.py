"""sync_state モジュールのユニットテスト（タスク 21.3）

テスト対象:
1. SyncState (seq ストア)
   - next_seq(path): 1 から始まり呼ぶたびに +1
   - get_seq(path): 最新の seq を返す（未知パスは 0）
   - get_all(): 全パスの seq を返す
   - 異なるパスは独立した seq を持つ

2. save ラップからの notebook_changed 発行
   - notify_notebook_changed 呼び出しで broadcast_event が呼ばれる
   - notebook_changed イベントに notebook_path と seq が含まれる

3. AiEventsPostHandler の認証
   - @web.authenticated デコレータが post メソッドに適用されている
"""

import importlib.util
import sys
import types as _types
from pathlib import Path

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
# 1. sync_state モジュールのロード
# sync_state.py は純粋モジュール（外部依存なし）の想定
# =============================================================================

sync_state = _load_module_fresh("custom_api.sync_state", "sync_state.py")


@pytest.fixture(autouse=True)
def _clear_state():
    """各テストの前後で seq ストアをクリアする"""
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()
    yield
    if hasattr(sync_state, "clear_all"):
        sync_state.clear_all()


# =============================================================================
# 1.1 next_seq(path) テスト
# =============================================================================


class TestNextSeq:
    """next_seq(path) のテスト"""

    def test_starts_at_1(self):
        """next_seq は最初の呼び出しで 1 を返す"""
        result = sync_state.next_seq("notebook.ipynb")
        assert result == 1

    def test_increments_on_each_call(self):
        """next_seq は呼ぶたびに +1 される"""
        r1 = sync_state.next_seq("notebook.ipynb")
        r2 = sync_state.next_seq("notebook.ipynb")
        r3 = sync_state.next_seq("notebook.ipynb")
        assert r1 == 1
        assert r2 == 2
        assert r3 == 3


# =============================================================================
# 1.2 get_seq(path) テスト
# =============================================================================


class TestGetSeq:
    """get_seq(path) のテスト"""

    def test_unknown_path_returns_0(self):
        """未知パスは 0 を返す"""
        result = sync_state.get_seq("unknown.ipynb")
        assert result == 0

    def test_returns_latest_seq(self):
        """next_seq で進めた後の最新 seq を返す"""
        sync_state.next_seq("notebook.ipynb")
        sync_state.next_seq("notebook.ipynb")
        result = sync_state.get_seq("notebook.ipynb")
        assert result == 2


# =============================================================================
# 1.3 get_all() テスト
# =============================================================================


class TestGetAll:
    """get_all() のテスト"""

    def test_empty_when_no_paths(self):
        """パスが登録されていない場合は空の辞書を返す"""
        result = sync_state.get_all()
        assert result == {}

    def test_returns_all_paths_with_seq(self):
        """全パスの seq を返す"""
        sync_state.next_seq("a.ipynb")
        sync_state.next_seq("a.ipynb")
        sync_state.next_seq("b.ipynb")
        result = sync_state.get_all()
        assert result == {"a.ipynb": 2, "b.ipynb": 1}


# =============================================================================
# 1.4 パス独立性テスト
# =============================================================================


class TestPathIndependence:
    """異なるパスは独立した seq を持つ"""

    def test_independent_seq_per_path(self):
        """異なるパスは互いの seq に影響しない"""
        sync_state.next_seq("a.ipynb")
        sync_state.next_seq("a.ipynb")
        sync_state.next_seq("a.ipynb")
        sync_state.next_seq("b.ipynb")
        assert sync_state.get_seq("a.ipynb") == 3
        assert sync_state.get_seq("b.ipynb") == 1


# =============================================================================
# 2. save ラップからの notebook_changed 発行テスト
# =============================================================================


class TestNotebookChangedOnSave:
    """notify_notebook_changed 呼び出しで broadcast_event が配信されるテスト

    notify_notebook_changed は sync_state モジュールの関数で、
    呼ばれると seq を進め、broadcast_event で
    {"type": "notebook_changed", "notebook_path": path, "seq": seq}
    を配信する。
    """

    def test_ipynb_save_broadcasts_notebook_changed(self):
        """notify_notebook_changed 呼び出しで notebook_changed イベントが配信される"""
        # sync_state を再ロード
        ss = _load_module_fresh("custom_api.sync_state", "sync_state.py")
        if hasattr(ss, "clear_all"):
            ss.clear_all()

        # notify_notebook_changed が存在することを確認
        assert hasattr(ss, "notify_notebook_changed"), "sync_state.notify_notebook_changed 関数が存在すること"

        # broadcast_event をモンキーパッチで差し替え
        # sync_state モジュールが内部で使う broadcast_event をキャプチャする
        broadcast_calls = []
        original_broadcast = None

        # sync_state が ai_events.broadcast_event を参照している想定
        # モジュール内のローカル参照を差し替える
        if hasattr(ss, "broadcast_event"):
            original_broadcast = ss.broadcast_event
            ss.broadcast_event = lambda event: broadcast_calls.append(event) or 0
        elif hasattr(ss, "_broadcast_event"):
            original_broadcast = ss._broadcast_event
            ss._broadcast_event = lambda event: broadcast_calls.append(event) or 0

        try:
            ss.notify_notebook_changed("analysis.ipynb")

            assert len(broadcast_calls) == 1
            event = broadcast_calls[0]
            assert event["type"] == "notebook_changed"
            assert event["notebook_path"] == "analysis.ipynb"
            assert event["seq"] == 1  # 最初の通知なので seq=1

            # 2回目の呼び出し
            ss.notify_notebook_changed("analysis.ipynb")
            assert len(broadcast_calls) == 2
            assert broadcast_calls[1]["seq"] == 2  # seq は +1

        finally:
            if original_broadcast is not None:
                if hasattr(ss, "broadcast_event"):
                    ss.broadcast_event = original_broadcast
                elif hasattr(ss, "_broadcast_event"):
                    ss._broadcast_event = original_broadcast

    def test_seq_in_event_matches_store(self):
        """notify_notebook_changed のイベント内 seq が get_seq と一致する"""
        ss = _load_module_fresh("custom_api.sync_state", "sync_state.py")
        if hasattr(ss, "clear_all"):
            ss.clear_all()

        broadcast_calls = []
        if hasattr(ss, "broadcast_event"):
            ss.broadcast_event = lambda event: broadcast_calls.append(event) or 0
        elif hasattr(ss, "_broadcast_event"):
            ss._broadcast_event = lambda event: broadcast_calls.append(event) or 0

        ss.notify_notebook_changed("test.ipynb")
        ss.notify_notebook_changed("test.ipynb")

        # get_seq は notify_notebook_changed で進んだ seq と一致する
        assert ss.get_seq("test.ipynb") == 2
        assert broadcast_calls[-1]["seq"] == 2


# =============================================================================
# 3. AiEventsPostHandler の @web.authenticated テスト
# =============================================================================


class TestAiEventsPostHandlerAuth:
    """AiEventsPostHandler に @web.authenticated が適用されていることを検証

    ソースコードを直接検査して @web.authenticated の存在を確認する。
    モジュールのロードは tornado 等の外部依存の問題を避けるためスキップする。
    """

    def test_post_handler_has_web_authenticated(self):
        """AiEventsPostHandler.post に @web.authenticated デコレータが付与されている"""
        # ai_events.py のソースコードを読み込んで検査する
        source_path = _ext_dir / "custom_api" / "ai_events.py"
        source = source_path.read_text(encoding="utf-8")

        # AiEventsPostHandler クラス内の post メソッドの前に
        # @web.authenticated が存在することを確認する
        import re

        # クラス定義を見つける
        class_match = re.search(
            r"class\s+AiEventsPostHandler\b.*?(?=\nclass\s|\Z)",
            source,
            re.DOTALL,
        )
        assert class_match is not None, "AiEventsPostHandler クラスが見つかりません"

        class_body = class_match.group()

        # post メソッドの直前に @web.authenticated があることを確認
        # パターン: @web.authenticated の後に async def post または def post がある
        has_auth = re.search(
            r"@web\.authenticated\s+(?:async\s+)?def\s+post\b",
            class_body,
        )
        assert has_auth is not None, "AiEventsPostHandler.post に @web.authenticated デコレータが適用されていません"
