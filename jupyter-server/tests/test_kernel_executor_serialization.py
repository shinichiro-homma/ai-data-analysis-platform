"""カーネル単位の実行直列化と msg_id フィルタのテスト

タスク 23.1: 同一カーネルへの並行 execute リクエストで出力が混線する問題を解消する。

対策は 2 層:
1. カーネル単位の asyncio.Lock による直列化（不変条件 I6 の充足）
2. parent_header.msg_id によるメッセージフィルタ（自リクエスト由来のみ収集）

テスト対象（いずれも kernel_executor.py に追加予定 / 変更予定）:
- `_kernel_locks: dict[str, asyncio.Lock]` + `_get_kernel_lock()`（未実装）
- `execute()` を async with で直列化（未実装）
- `client.execute(code)` の msg_id で parent_header 不一致メッセージを skip（未実装）
- `cleanup_kernel_state()` がロックエントリを削除（未実装）

Red フェーズ: 直列化・フィルタ・掃除のテストは実装前なので失敗（FAIL）するのが正常。
正常系リグレッションテストは現行実装でも PASS しうる（フィルタ導入後も通ることを保証する目的）。
"""

import asyncio
import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

# --- モジュールのセットアップ ---
# custom_api パッケージの __init__.py を経由せず、kernel_executor を単体ロードする。
# jupyter_client 等の外部依存はモックで置き換える
# （test_kernel_crash_recovery.py:26-107 のパターンを踏襲）

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


# 1. custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# 2. 外部依存のモック（kernel_executor は AsyncKernelClient を型注釈でのみ使用）
_ensure_mock_module("jupyter_client", AsyncKernelClient=MagicMock)

# 3. kernel_executor モジュールをロード
kernel_executor = _load_module("custom_api.kernel_executor", "kernel_executor.py")

KernelExecutor = kernel_executor.KernelExecutor
cleanup_kernel_state = kernel_executor.cleanup_kernel_state


# =============================================================================
# fake の kernel_manager / client
# =============================================================================


def _msg(msg_type: str, parent_msg_id: str, content: dict | None = None) -> dict:
    """scripted IOPub メッセージを 1 件生成する。"""
    return {
        "header": {"msg_type": msg_type},
        "parent_header": {"msg_id": parent_msg_id},
        "content": content or {},
    }


class FakeKernelClient:
    """scripted IOPub メッセージを順に返す fake client。

    - execute(code): 呼び出しごとに一意な msg_id 文字列を返す
    - get_iopub_msg(): scripts に積まれたメッセージを async で順に返す

    msg_id を各実行に紐づける必要があるテストでは、execute() が返した msg_id を
    使ってメッセージ台本を組み立てる（parent_header.msg_id に埋め込む）。
    """

    def __init__(self):
        self.msg_counter = 0
        self.executed_codes: list[str] = []
        self.executed_msg_ids: list[str] = []
        # 収集ループが取り出す IOPub メッセージのキュー
        self._queue: list[dict] = []
        self.channels_started = False
        self.channels_stopped = False
        # get_iopub_msg 内で発生させる例外（None なら通常動作）
        self.raise_on_get: BaseException | None = None
        # 台本を組み立てるコールバック（execute 時に msg_id を受け取り台本を返す）
        self.script_builder = None

    def start_channels(self) -> None:
        self.channels_started = True

    def stop_channels(self) -> None:
        self.channels_stopped = True

    def execute(self, code: str) -> str:
        self.msg_counter += 1
        msg_id = f"msg-{self.msg_counter}"
        self.executed_codes.append(code)
        self.executed_msg_ids.append(msg_id)
        if self.script_builder is not None:
            self._queue.extend(self.script_builder(msg_id))
        return msg_id

    async def get_iopub_msg(self):
        # await 境界を明示的に作る（実時間 sleep には依存しない）
        await asyncio.sleep(0)
        if self.raise_on_get is not None:
            raise self.raise_on_get
        if not self._queue:
            # メッセージ枯渇: 現行実装の deadline 方式では TimeoutError を
            # wait_for 側が投げるため、ここでは無限待機に相当する挙動にする。
            # ただし実時間依存を避けるため、テスト側でタイムアウトを短く設定する。
            await asyncio.sleep(3600)
        return self._queue.pop(0)


class FakeKernel:
    def __init__(self, client: FakeKernelClient):
        self._client = client

    def client(self) -> FakeKernelClient:
        return self._client


class FakeKernelManager:
    """kernel_id → FakeKernel のマッピングを返す fake。"""

    def __init__(self, kernels: dict[str, FakeKernel]):
        self._kernels = kernels

    def get_kernel(self, kernel_id: str) -> FakeKernel:
        return self._kernels[kernel_id]


def _make_executor(kernel_id: str, client: FakeKernelClient) -> KernelExecutor:
    manager = FakeKernelManager({kernel_id: FakeKernel(client)})
    return KernelExecutor(kernel_id, manager)


def _normal_script(msg_id: str) -> list[dict]:
    """自リクエストの正常系メッセージ台本（idle で終端）。"""
    return [
        _msg("execute_input", msg_id, {"execution_count": 1}),
        _msg("stream", msg_id, {"name": "stdout", "text": "hello\n"}),
        _msg("status", msg_id, {"execution_state": "idle"}),
    ]


# =============================================================================
# 1. カーネル単位の直列化
# =============================================================================


class TestKernelExecutionSerialization:
    """カーネル単位 asyncio.Lock による execute() の直列化（完了条件: 並行・異常系）"""

    def test_concurrent_execute_on_same_kernel_is_serialized(self):
        """同一 kernel_id への 2 並行 execute() で、後発の client.execute() 呼び出しが
        先発の完了後になる（完了条件: 並行・異常系）。

        Red フェーズ: 直列化未実装だと 2 つの execute() が同時に走り、
        先発が idle を受け取る前に後発が client.execute() を呼ぶため失敗する。
        """
        kernel_id = "k-serial"
        client = FakeKernelClient()

        # 先発の実行を任意のタイミングまで待たせるゲート
        first_started = asyncio.Event()
        release_first = asyncio.Event()

        # 台本: 先発は release_first がセットされるまで idle を返さないようにするため、
        # get_iopub_msg をラップして先発の idle 直前でブロックする。
        client.script_builder = _normal_script

        orig_get = client.get_iopub_msg

        first_msg_id_holder: dict[str, str] = {}

        async def gated_get_iopub_msg():
            msg = await orig_get()
            # 先発（msg-1）の idle を、release_first まで遅延させる
            if (
                msg["header"]["msg_type"] == "status"
                and msg["content"].get("execution_state") == "idle"
                and msg["parent_header"]["msg_id"] == first_msg_id_holder.get("id")
            ):
                first_started.set()
                await release_first.wait()
            return msg

        async def first():
            # 先発が client.execute() を呼ぶのを保証するため、少し先行させる
            await asyncio.sleep(0)
            result = await asyncio.wait_for(executor.execute("first-code", timeout=5), timeout=5)
            return result

        async def second():
            # 先発が client.execute() を呼び終えるまで待ってから開始
            await first_started.wait()
            result = await asyncio.wait_for(executor.execute("second-code", timeout=5), timeout=5)
            return result

        executor = _make_executor(kernel_id, client)

        async def scenario():
            # 先発の msg_id は最初の execute で msg-1 になる
            first_msg_id_holder["id"] = "msg-1"
            client.get_iopub_msg = gated_get_iopub_msg  # type: ignore[method-assign]

            first_task = asyncio.create_task(first())
            # 先発が client.execute() を呼び、idle 直前でブロックするまで待つ
            await first_started.wait()

            second_task = asyncio.create_task(second())
            # 後発が _get_client() の sleep(0.1) を確実に通過し、
            # client.execute() を呼べる地点まで進む猶予を与える（実時間 0.3 秒）。
            # 直列化されていれば、後発はロック取得待ちでここに到達できない。
            await asyncio.sleep(0.3)

            # ここで先発はまだ idle を受け取っていない（release_first でブロック中）。
            # 直列化されていれば後発はまだ client.execute() を呼べていないはず。
            executed_before_release = list(client.executed_codes)

            # 先発を解放
            release_first.set()
            await asyncio.gather(first_task, second_task)
            return executed_before_release

        executed_before_release = asyncio.run(scenario())

        # 直列化されていれば、先発解放前に後発（second-code）は実行されていない
        assert "second-code" not in executed_before_release, (
            "後発の client.execute() が先発の完了前に呼ばれた（直列化されていない）"
        )
        # 最終的には両方実行される
        assert client.executed_codes == ["first-code", "second-code"]
        cleanup_kernel_state(kernel_id)

    def test_different_kernels_have_independent_locks(self):
        """異なる kernel_id はロックが独立で並行実行できる（完了条件: 並行・異常系の対照）。

        Red フェーズ: _get_kernel_lock 未実装だと属性参照で失敗する。
        """
        assert hasattr(kernel_executor, "_get_kernel_lock"), (
            "_get_kernel_lock is not yet implemented in kernel_executor.py"
        )
        lock_a = kernel_executor._get_kernel_lock("k-a")
        lock_b = kernel_executor._get_kernel_lock("k-b")
        assert lock_a is not lock_b, "異なる kernel_id が同一ロックを共有している"

        # 2 つのカーネルの execute は同時進行できる（互いにブロックしない）
        client_a = FakeKernelClient()
        client_b = FakeKernelClient()
        client_a.script_builder = _normal_script
        client_b.script_builder = _normal_script
        executor_a = _make_executor("k-a", client_a)
        executor_b = _make_executor("k-b", client_b)

        async def scenario():
            results = await asyncio.gather(
                asyncio.wait_for(executor_a.execute("a-code", timeout=5), timeout=5),
                asyncio.wait_for(executor_b.execute("b-code", timeout=5), timeout=5),
            )
            return results

        results = asyncio.run(scenario())
        assert results[0]["success"] is True
        assert results[1]["success"] is True
        cleanup_kernel_state("k-a")
        cleanup_kernel_state("k-b")


# =============================================================================
# 2. parent_header.msg_id フィルタ
# =============================================================================


class TestParentMsgIdFilter:
    """自リクエスト由来（parent msg_id 一致）のメッセージのみ収集する"""

    def test_foreign_stream_message_not_collected(self):
        """parent msg_id が不一致の stream メッセージが outputs に混入しない
        （完了条件: タイムアウト・異常系の混入防止）。

        Red フェーズ: フィルタ未実装だと他リクエストの stream が outputs に入り失敗する。
        """
        client = FakeKernelClient()

        def script_builder(msg_id: str) -> list[dict]:
            return [
                _msg("execute_input", msg_id, {"execution_count": 1}),
                # 自リクエストの出力
                _msg("stream", msg_id, {"name": "stdout", "text": "mine\n"}),
                # 他リクエスト（前実行の遅延メッセージ）由来の出力
                _msg("stream", "other-msg-id", {"name": "stdout", "text": "foreign\n"}),
                _msg("status", msg_id, {"execution_state": "idle"}),
            ]

        client.script_builder = script_builder
        executor = _make_executor("k-filter-stream", client)

        result = asyncio.run(asyncio.wait_for(executor.execute("code", timeout=5), timeout=5))

        texts = [o["text"] for o in result["outputs"]]
        assert "mine\n" in texts, "自リクエストの出力が収集されていない"
        assert "foreign\n" not in texts, "他リクエスト由来の stream が outputs に混入した（フィルタ未実装）"
        cleanup_kernel_state("k-filter-stream")

    def test_foreign_idle_does_not_terminate_collection(self):
        """parent msg_id が不一致の status:idle で収集ループが終了しない
        （自分の idle でのみ終了する）（完了条件: タイムアウト・異常系）。

        Red フェーズ: フィルタ未実装だと他リクエストの idle で早期終了し、
        自リクエストの後続 stream を取りこぼして失敗する。
        """
        client = FakeKernelClient()

        def script_builder(msg_id: str) -> list[dict]:
            return [
                _msg("execute_input", msg_id, {"execution_count": 1}),
                # 他リクエストの idle（これで終了してはいけない）
                _msg("status", "other-msg-id", {"execution_state": "idle"}),
                # 自リクエストの出力（早期終了すると取りこぼす）
                _msg("stream", msg_id, {"name": "stdout", "text": "after-foreign-idle\n"}),
                # 自リクエストの idle（ここで初めて終了する）
                _msg("status", msg_id, {"execution_state": "idle"}),
            ]

        client.script_builder = script_builder
        executor = _make_executor("k-filter-idle", client)

        result = asyncio.run(asyncio.wait_for(executor.execute("code", timeout=5), timeout=5))

        texts = [o["text"] for o in result["outputs"]]
        assert "after-foreign-idle\n" in texts, "他リクエストの idle で早期終了し、自リクエストの後続出力を取りこぼした"
        cleanup_kernel_state("k-filter-idle")

    def test_own_messages_collected_regression(self):
        """正常系: 自リクエストの stream / execute_result / error が従来どおり収集される
        （リグレッション防止。現行実装でも PASS しうる）。
        """
        client = FakeKernelClient()

        def script_builder(msg_id: str) -> list[dict]:
            return [
                _msg("execute_input", msg_id, {"execution_count": 7}),
                _msg("stream", msg_id, {"name": "stdout", "text": "line1\n"}),
                _msg(
                    "execute_result",
                    msg_id,
                    {"execution_count": 7, "data": {"text/plain": "42"}},
                ),
                _msg(
                    "error",
                    msg_id,
                    {
                        "ename": "ValueError",
                        "evalue": "boom",
                        "traceback": ["Traceback", "ValueError: boom"],
                    },
                ),
                _msg("status", msg_id, {"execution_state": "idle"}),
            ]

        client.script_builder = script_builder
        executor = _make_executor("k-regression", client)

        result = asyncio.run(asyncio.wait_for(executor.execute("code", timeout=5), timeout=5))

        assert result["execution_count"] == 7
        texts = [o["text"] for o in result["outputs"]]
        assert "line1\n" in texts
        assert result["result"] == "42"
        assert result["error"] is not None
        assert result["error"]["type"] == "ValueError"
        assert result["error"]["message"] == "boom"
        assert result["success"] is False
        cleanup_kernel_state("k-regression")


# =============================================================================
# 3. ロック解放（タイムアウト / 例外）
# =============================================================================


class TestLockRelease:
    """タイムアウト・例外でもロックが解放され、後続 execute() が成功する"""

    def test_lock_released_after_timeout(self):
        """タイムアウト（自分の idle が来ない）で TimeoutError 送出後、
        後続の execute() がロックを取得して成功する（完了条件: タイムアウト・異常系）。

        Red フェーズ: ロック未実装（かつ finally 解放が正しくない）だと、
        後続 execute() がロックを取得できず（またはデッドロックで）失敗する。
        """
        kernel_id = "k-timeout"
        client = FakeKernelClient()

        # 1 回目: idle を返さない台本（execute_input のみ → タイムアウトさせる）
        # 2 回目: 正常に idle で終端する台本
        call_count = {"n": 0}

        def script_builder(msg_id: str) -> list[dict]:
            call_count["n"] += 1
            if call_count["n"] == 1:
                # idle なし → deadline 到達で TimeoutError
                return [_msg("execute_input", msg_id, {"execution_count": 1})]
            return _normal_script(msg_id)

        client.script_builder = script_builder
        executor = _make_executor(kernel_id, client)

        async def scenario():
            # 1 回目はタイムアウトする（timeout=1 秒だが _queue 枯渇後は 3600 秒 sleep に入る）
            with pytest.raises(TimeoutError):
                await asyncio.wait_for(executor.execute("first", timeout=1), timeout=5)
            # 2 回目はロックが解放されていれば成功する
            result = await asyncio.wait_for(executor.execute("second", timeout=5), timeout=5)
            return result

        result = asyncio.run(scenario())
        assert result["success"] is True
        # ロックが解放されていること（保持されたままなら後続が取得できない）。
        # Red フェーズ: ロック未実装だと _get_kernel_lock が無く、属性参照で失敗する。
        assert hasattr(kernel_executor, "_get_kernel_lock"), (
            "_get_kernel_lock is not yet implemented in kernel_executor.py"
        )
        assert not kernel_executor._get_kernel_lock(kernel_id).locked(), (
            "タイムアウト後もロックが保持されたままになっている"
        )
        cleanup_kernel_state(kernel_id)

    def test_lock_released_after_exception(self):
        """get_iopub_msg() が例外を投げてもロックが解放される（完了条件: 例外・異常系）。

        Red フェーズ: ロック未実装だと _get_kernel_lock が無く、
        解放状態の検証（属性参照）で失敗する。
        """
        kernel_id = "k-exception"
        client = FakeKernelClient()
        client.raise_on_get = RuntimeError("iopub receive failed")

        # execute() 自体は client.execute() を呼ぶため台本ビルダは不要
        def script_builder(msg_id: str) -> list[dict]:
            return []

        client.script_builder = script_builder
        executor = _make_executor(kernel_id, client)

        async def scenario():
            with pytest.raises(RuntimeError):
                await asyncio.wait_for(executor.execute("code", timeout=5), timeout=5)

        asyncio.run(scenario())

        assert hasattr(kernel_executor, "_get_kernel_lock"), (
            "_get_kernel_lock is not yet implemented in kernel_executor.py"
        )
        assert not kernel_executor._get_kernel_lock(kernel_id).locked(), (
            "IOPub 受信中の例外後もロックが保持されたままになっている"
        )
        cleanup_kernel_state(kernel_id)


# =============================================================================
# 4. 掃除
# =============================================================================


class TestCleanup:
    """cleanup_kernel_state() がロックエントリを削除する（完了条件: 掃除）"""

    def test_cleanup_removes_lock_entry(self):
        """cleanup_kernel_state() が _kernel_locks のエントリを削除する。

        Red フェーズ: _kernel_locks 未実装だと属性参照で失敗する。
        """
        assert hasattr(kernel_executor, "_kernel_locks"), "_kernel_locks is not yet implemented in kernel_executor.py"
        assert hasattr(kernel_executor, "_get_kernel_lock"), (
            "_get_kernel_lock is not yet implemented in kernel_executor.py"
        )

        kernel_id = "k-cleanup"
        # ロックを生成して辞書に登録させる
        kernel_executor._get_kernel_lock(kernel_id)
        assert kernel_id in kernel_executor._kernel_locks

        cleanup_kernel_state(kernel_id)
        assert kernel_id not in kernel_executor._kernel_locks, "cleanup_kernel_state() がロックエントリを削除していない"
