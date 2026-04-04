"""
カーネル実行ヘルパー

Jupyter カーネルとの通信を管理し、コード実行と変数取得を行う。
"""

import asyncio
import base64
import json
import logging
import re
from pathlib import Path
from typing import Any

from jupyter_client import AsyncKernelClient

log = logging.getLogger(__name__)

# カーネルごとの画像出力カウンター（セッション横断で連番を振るため）
_kernel_image_counters: dict[str, int] = {}


def _next_image_index(kernel_id: str) -> int:
    """カーネルの画像カウンターをインクリメントし、新しいインデックスを返す。"""
    count = _kernel_image_counters.get(kernel_id, 0) + 1
    _kernel_image_counters[kernel_id] = count
    return count


def cleanup_kernel_state(kernel_id: str) -> None:
    """カーネル削除時に画像カウンターをクリーンアップする。"""
    _kernel_image_counters.pop(kernel_id, None)


def _save_display_image(
    img_data: str,
    image_index: int,
    execution_count: int,
    output_dir: Path | None,
    workspace_rel_path: str | None,
) -> dict:
    """display_data の画像を保存し、メタデータ dict を返す。"""
    file_path = None

    if output_dir and workspace_rel_path:
        try:
            filename = f"exec-{execution_count}-img-{image_index:03d}.png"
            img_bytes = base64.b64decode(img_data)
            output_dir.mkdir(parents=True, exist_ok=True)
            (output_dir / filename).write_bytes(img_bytes)
            file_path = f"{workspace_rel_path}/output/{filename}"
        except Exception:
            log.warning("Failed to save image to %s", output_dir, exc_info=True)

    return {
        "file_path": file_path,
        "mime_type": "image/png",
        "description": f"matplotlib output [{image_index}]",
    }


class KernelExecutor:
    """カーネルとの通信を管理するクラス"""

    def __init__(self, kernel_id: str, kernel_manager):
        self.kernel_id = kernel_id
        self.kernel_manager = kernel_manager

    def _parse_json_output(self, outputs: list) -> Any | None:
        """標準出力からJSON結果をパースする共通処理"""
        for output in outputs:
            if output.get("type") == "stdout":
                try:
                    return json.loads(output["text"].strip())
                except (json.JSONDecodeError, KeyError):
                    pass
        return None

    async def _get_client(self) -> AsyncKernelClient:
        """カーネルクライアントを取得"""
        kernel = self.kernel_manager.get_kernel(self.kernel_id)
        client = kernel.client()
        client.start_channels()
        # チャンネルの準備を待つ
        await asyncio.sleep(0.1)
        return client

    async def execute(
        self,
        code: str,
        timeout: int = 30,
        output_dir: Path | None = None,
        workspace_rel_path: str | None = None,
    ) -> dict:
        """コードを実行"""
        client = await self._get_client()

        try:
            # コードを実行
            _ = client.execute(code)

            # 結果を収集
            outputs = []
            images = []
            result = None
            error = None
            execution_count = 0

            deadline = asyncio.get_running_loop().time() + timeout

            while True:
                remaining = deadline - asyncio.get_running_loop().time()
                if remaining <= 0:
                    raise TimeoutError(f"Execution timed out after {timeout} seconds")

                try:
                    msg = await asyncio.wait_for(client.get_iopub_msg(), timeout=min(remaining, 1.0))
                except TimeoutError:
                    continue

                msg_type = msg["header"]["msg_type"]
                content = msg["content"]

                if msg_type == "status":
                    if content.get("execution_state") == "idle":
                        break

                elif msg_type == "execute_input":
                    execution_count = content.get("execution_count", 0)

                elif msg_type == "stream":
                    stream_name = content.get("name", "stdout")
                    text = content.get("text", "")
                    outputs.append(
                        {
                            "type": stream_name,
                            "text": text,
                        }
                    )

                elif msg_type == "execute_result":
                    execution_count = content.get("execution_count", 0)
                    data = content.get("data", {})
                    if "text/plain" in data:
                        result = data["text/plain"]

                elif msg_type == "display_data":
                    data = content.get("data", {})
                    if "image/png" in data:
                        image_entry = _save_display_image(
                            img_data=data["image/png"],
                            image_index=_next_image_index(self.kernel_id),
                            execution_count=execution_count,
                            output_dir=output_dir,
                            workspace_rel_path=workspace_rel_path,
                        )
                        images.append(image_entry)

                elif msg_type == "error":
                    error = {
                        "type": content.get("ename", "Error"),
                        "message": content.get("evalue", "Unknown error"),
                        "traceback": content.get("traceback", []),
                    }

            return {
                "success": error is None,
                "execution_count": execution_count,
                "outputs": outputs,
                "result": result,
                "images": images,
                "error": error,
            }

        finally:
            client.stop_channels()

    async def get_execution_count(self) -> int:
        """現在の実行カウントを取得"""
        result = await self.execute("_execution_count = get_ipython().execution_count; _execution_count", timeout=5)
        if result["success"] and result["result"]:
            try:
                return int(result["result"])
            except (ValueError, TypeError):
                return 0
        return 0

    async def get_variables(self) -> list:
        """定義済み変数の一覧を取得"""
        code = """
import json
import sys

def _get_variable_info():
    from IPython import get_ipython
    ip = get_ipython()
    user_ns = ip.user_ns

    # システム変数を除外
    exclude = {'In', 'Out', 'get_ipython', 'exit', 'quit', '_', '__', '___',
               '_i', '_ii', '_iii', '_oh', '_dh', '_sh', '_execution_count'}

    variables = []
    for name, value in user_ns.items():
        if name.startswith('_') or name in exclude:
            continue
        if callable(value) and not hasattr(value, '__module__'):
            continue
        if hasattr(value, '__module__') and value.__module__ and value.__module__.startswith('IPython'):
            continue

        var_info = {
            'name': name,
            'type': type(value).__name__,
        }

        # DataFrameの場合
        if type(value).__name__ == 'DataFrame':
            var_info['size'] = f"{len(value)} rows × {len(value.columns)} cols"
            var_info['memory_bytes'] = int(value.memory_usage(deep=True).sum())
        # 単純な値の場合
        elif type(value).__name__ in ('int', 'float', 'str', 'bool'):
            var_info['value'] = value
        # リストや辞書の場合
        elif type(value).__name__ in ('list', 'dict'):
            var_info['size'] = str(len(value))

        variables.append(var_info)

    return variables

print(json.dumps(_get_variable_info()))
del _get_variable_info
"""
        result = await self.execute(code, timeout=10)
        if result["success"] and result["outputs"]:
            parsed = self._parse_json_output(result["outputs"])
            if parsed is not None:
                return parsed
        return []

    async def get_variable(self, name: str) -> dict | None:
        """指定した変数の詳細を取得"""
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
            raise ValueError(f"Invalid variable name: {name}")

        code = f'''
import json

def _get_variable_detail(var_name):
    from IPython import get_ipython
    ip = get_ipython()

    if var_name not in ip.user_ns:
        return None

    value = ip.user_ns[var_name]
    var_info = {{
        'name': var_name,
        'type': type(value).__name__,
    }}

    # DataFrameの場合
    if type(value).__name__ == 'DataFrame':
        var_info['shape'] = list(value.shape)
        var_info['columns'] = [
            {{'name': str(col), 'dtype': str(value[col].dtype)}}
            for col in value.columns
        ]
        var_info['head'] = value.head(5).to_dict(orient='records')

        # describeを計算
        describe = {{}}
        for col in value.select_dtypes(include=['number']).columns:
            stats = value[col].describe()
            describe[str(col)] = {{
                'count': int(stats.get('count', 0)),
                'mean': float(stats.get('mean', 0)),
                'std': float(stats.get('std', 0)) if 'std' in stats else None,
                'min': float(stats.get('min', 0)),
                'max': float(stats.get('max', 0)),
            }}
        var_info['describe'] = describe
        var_info['memory_bytes'] = int(value.memory_usage(deep=True).sum())

    # 単純な値の場合
    elif type(value).__name__ in ('int', 'float', 'str', 'bool'):
        var_info['value'] = value

    # リストの場合
    elif type(value).__name__ == 'list':
        var_info['value'] = value[:100]  # 最大100要素
        var_info['size'] = str(len(value))

    # 辞書の場合
    elif type(value).__name__ == 'dict':
        var_info['value'] = dict(list(value.items())[:100])  # 最大100項目
        var_info['size'] = str(len(value))

    return var_info

result = _get_variable_detail("{name}")
print(json.dumps(result))
del _get_variable_detail
'''
        result = await self.execute(code, timeout=10)
        if result["success"] and result["outputs"]:
            return self._parse_json_output(result["outputs"])
        return None
