"""KernelExecutor のカーネル単位実行直列化ロックのテスト

Phase 23.1: カーネル ID ごとの asyncio.Lock で並行実行を直列化し、
stdout の混線を防止する。ロック待ちタイムアウトも検証する。

kernel_executor.py は jupyter_client 等の重い依存を持つため、
必要な箇所をモックしてユニットテストする。
"""

import asyncio
import contextlib
import importlib.util
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"

# --- 1. 重い依存のモック ---
if "jupyter_client" not in sys.modules:
    _jc = _types.ModuleType("jupyter_client")
    _jc.AsyncKernelClient = type("AsyncKernelClient", (), {})
    sys.modules["jupyter_client"] = _jc

# --- 2. custom_api パッケージ構造の構築 ---
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# --- 3. kernel_executor をロード ---
_module_path = _ext_dir / "custom_api" / "kernel_executor.py"
spec = importlib.util.spec_from_file_location(
    "custom_api.kernel_executor",
    _module_path,
    submodule_search_locations=[],
)
_ke_module = importlib.util.module_from_spec(spec)
_ke_module.__package__ = "custom_api"
sys.modules["custom_api.kernel_executor"] = _ke_module
spec.loader.exec_module(_ke_module)

KernelExecutor = _ke_module.KernelExecutor


# --- ヘルパー ---


def _make_mock_kernel_manager(kernel_id: str, messages_fn):
    """モックカーネルマネージャーを作成する。

    messages_fn: async generator を返す callable。get_iopub_msg の戻り値を制御する。
    """
    mock_client = MagicMock()
    mock_client.execute = MagicMock(return_value="msg-id-1")
    mock_client.start_channels = MagicMock()
    mock_client.stop_channels = MagicMock()

    # get_iopub_msg を async にする
    msg_iter = messages_fn()

    async def _get_iopub_msg():
        return await msg_iter.__anext__()

    mock_client.get_iopub_msg = _get_iopub_msg

    mock_kernel = MagicMock()
    mock_kernel.client.return_value = mock_client

    mock_km = MagicMock()
    mock_km.get_kernel.return_value = mock_kernel

    return mock_km


def _make_messages(stdout_text: str, delay: float = 0.0):
    """stdout メッセージシーケンスを生成する async generator ファクトリ。"""

    async def _gen():
        # execute_input
        yield {
            "header": {"msg_type": "execute_input"},
            "content": {"execution_count": 1},
        }
        if delay > 0:
            await asyncio.sleep(delay)
        # stream stdout
        yield {
            "header": {"msg_type": "stream"},
            "content": {"name": "stdout", "text": stdout_text},
        }
        # status idle
        yield {
            "header": {"msg_type": "status"},
            "content": {"execution_state": "idle"},
        }

    return _gen


# --- テスト ---


class TestKernelExecutorSerialLock:
    """同一カーネルへの並行 execute が直列化され、stdout が混線しないことを検証する。

    Phase 23.1 では kernel_executor.py にカーネル ID ごとの asyncio.Lock を導入し、
    同一カーネルへの同時実行リクエストをキューイングする。
    """

    @pytest.mark.asyncio
    async def test_concurrent_execute_no_interleaving(self):
        """asyncio.gather で 2 つの execute を並行送信し、
        それぞれの stdout が独立して返ることを検証する。

        ロックがなければ IOPub メッセージが混線する可能性がある。
        """
        kernel_id = "test-kernel-001"
        execution_order = []

        # 各実行で異なる出力を返すメッセージシーケンス
        call_count = 0

        def _make_km():
            """呼び出しごとに異なるメッセージを返すカーネルマネージャー"""
            nonlocal call_count

            async def _gen_a():
                execution_order.append("a-start")
                yield {
                    "header": {"msg_type": "execute_input"},
                    "content": {"execution_count": 1},
                }
                await asyncio.sleep(0.05)  # 実行に時間がかかるシミュレーション
                yield {
                    "header": {"msg_type": "stream"},
                    "content": {"name": "stdout", "text": "output-A\n"},
                }
                execution_order.append("a-end")
                yield {
                    "header": {"msg_type": "status"},
                    "content": {"execution_state": "idle"},
                }

            async def _gen_b():
                execution_order.append("b-start")
                yield {
                    "header": {"msg_type": "execute_input"},
                    "content": {"execution_count": 2},
                }
                yield {
                    "header": {"msg_type": "stream"},
                    "content": {"name": "stdout", "text": "output-B\n"},
                }
                execution_order.append("b-end")
                yield {
                    "header": {"msg_type": "status"},
                    "content": {"execution_state": "idle"},
                }

            generators = [_gen_a, _gen_b]

            mock_client = MagicMock()
            mock_client.execute = MagicMock(return_value="msg-id")
            mock_client.start_channels = MagicMock()
            mock_client.stop_channels = MagicMock()

            # client() を呼ぶたびに新しい generator を使う
            gen_index = [0]

            def _make_client():
                nonlocal gen_index
                idx = gen_index[0]
                gen_index[0] += 1
                gen = generators[idx]()

                client = MagicMock()
                client.execute = MagicMock(return_value=f"msg-id-{idx}")
                client.start_channels = MagicMock()
                client.stop_channels = MagicMock()

                async def _get_msg():
                    return await gen.__anext__()

                client.get_iopub_msg = _get_msg
                return client

            mock_kernel = MagicMock()
            mock_kernel.client = _make_client

            mock_km = MagicMock()
            mock_km.get_kernel.return_value = mock_kernel
            return mock_km

        km = _make_km()
        executor = KernelExecutor(kernel_id, km)

        # 2 つの execute を並行実行
        results = await asyncio.gather(
            executor.execute("print('A')", timeout=5),
            executor.execute("print('B')", timeout=5),
        )

        result_a, result_b = results

        # ロックにより直列化されている場合、a が完了してから b が開始するはず
        # a-start, a-end, b-start, b-end の順序になる
        assert execution_order == ["a-start", "a-end", "b-start", "b-end"], (
            f"Expected serial execution order but got: {execution_order}. Kernel-level lock is not implemented yet."
        )

        # 各結果が独立していること
        assert result_a["success"] is True
        assert any("output-A" in o["text"] for o in result_a["outputs"])
        assert result_b["success"] is True
        assert any("output-B" in o["text"] for o in result_b["outputs"])

    @pytest.mark.asyncio
    async def test_different_kernels_execute_concurrently(self):
        """異なるカーネル ID への execute は並行実行されること。

        カーネルごとに独立したロックを持つため、
        異なるカーネルへのリクエストは直列化されない。
        """
        execution_order = []

        def _make_km_for(label: str):
            async def _gen():
                execution_order.append(f"{label}-start")
                yield {
                    "header": {"msg_type": "execute_input"},
                    "content": {"execution_count": 1},
                }
                await asyncio.sleep(0.05)
                yield {
                    "header": {"msg_type": "stream"},
                    "content": {"name": "stdout", "text": f"output-{label}\n"},
                }
                execution_order.append(f"{label}-end")
                yield {
                    "header": {"msg_type": "status"},
                    "content": {"execution_state": "idle"},
                }

            return _make_mock_kernel_manager(f"kernel-{label}", lambda: _gen())

        km_x = _make_km_for("X")
        km_y = _make_km_for("Y")

        executor_x = KernelExecutor("kernel-X", km_x)
        executor_y = KernelExecutor("kernel-Y", km_y)

        await asyncio.gather(
            executor_x.execute("print('X')", timeout=5),
            executor_y.execute("print('Y')", timeout=5),
        )

        # 異なるカーネルなので並行実行される: X-start と Y-start が連続する
        # （直列化されていない）
        assert execution_order[0].endswith("-start")
        assert execution_order[1].endswith("-start")


class TestKernelExecutorLockTimeout:
    """ロック取得タイムアウト時に適切なエラーが返ることを検証する。

    Phase 23.1 では長時間ロックが保持されている場合に、
    後続リクエストがタイムアウトで適切なエラーを返す。
    """

    @pytest.mark.asyncio
    async def test_lock_wait_timeout_returns_error(self):
        """ロック待ちがタイムアウトした場合に適切なエラーが返ること。

        まだ実装されていないため、このテストは Red フェーズで失敗する。
        実装では asyncio.wait_for でロック取得にタイムアウトを設定し、
        タイムアウト時に TimeoutError またはカスタムエラーを返す想定。
        """
        kernel_id = "test-kernel-timeout"

        # 長時間実行をシミュレートするメッセージ
        async def _slow_gen():
            yield {
                "header": {"msg_type": "execute_input"},
                "content": {"execution_count": 1},
            }
            # 非常に長い実行（ロックを長時間保持）
            await asyncio.sleep(10)
            yield {
                "header": {"msg_type": "status"},
                "content": {"execution_state": "idle"},
            }

        km = _make_mock_kernel_manager(kernel_id, lambda: _slow_gen())
        executor = KernelExecutor(kernel_id, km)

        # 1 つ目の実行を開始（ロックを取得して長時間保持）
        task1 = asyncio.create_task(executor.execute("slow_code()", timeout=10))
        # ロック取得を待つ
        await asyncio.sleep(0.1)

        # 2 つ目の実行はロック待ちタイムアウトすべき
        # executor.execute(timeout=1) → lock_timeout = 1 + 5 = 6 秒
        # task1 がロックを 10 秒間保持するため、6 秒で TimeoutError が発生する
        # 外側の wait_for は実装の lock_timeout より十分大きくし、
        # 実装自体の TimeoutError を確実にキャッチする
        try:
            await asyncio.wait_for(
                executor.execute("print('should timeout')", timeout=1),
                timeout=15,
            )
            pytest.fail("Expected lock wait timeout but execute completed without error.")
        except TimeoutError:
            # 実装の lock_timeout（6秒）によるタイムアウト = 期待する動作
            pass
        finally:
            task1.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task1
