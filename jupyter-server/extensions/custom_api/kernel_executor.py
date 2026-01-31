"""
カーネル実行ヘルパー

Jupyter カーネルとの通信を管理し、コード実行と変数取得を行う。
"""

import asyncio
import base64
from typing import Any, Optional

from jupyter_client import AsyncKernelClient
from jupyter_client.session import Session


class KernelExecutor:
    """カーネルとの通信を管理するクラス"""

    def __init__(self, kernel_id: str, kernel_manager):
        self.kernel_id = kernel_id
        self.kernel_manager = kernel_manager

    async def _get_client(self) -> AsyncKernelClient:
        """カーネルクライアントを取得"""
        kernel = self.kernel_manager.get_kernel(self.kernel_id)
        client = kernel.client()
        client.start_channels()
        # チャンネルの準備を待つ
        await asyncio.sleep(0.1)
        return client

    async def execute(self, code: str, timeout: int = 30) -> dict:
        """コードを実行"""
        client = await self._get_client()

        try:
            # コードを実行
            msg_id = client.execute(code)

            # 結果を収集
            outputs = []
            images = []
            result = None
            error = None
            execution_count = 0

            deadline = asyncio.get_event_loop().time() + timeout

            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    raise TimeoutError(f"Execution timed out after {timeout} seconds")

                try:
                    msg = await asyncio.wait_for(
                        client.get_iopub_msg(),
                        timeout=min(remaining, 1.0)
                    )
                except asyncio.TimeoutError:
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
                    outputs.append({
                        "type": stream_name,
                        "text": text,
                    })

                elif msg_type == "execute_result":
                    execution_count = content.get("execution_count", 0)
                    data = content.get("data", {})
                    if "text/plain" in data:
                        result = data["text/plain"]

                elif msg_type == "display_data":
                    data = content.get("data", {})
                    if "image/png" in data:
                        img_data = data["image/png"]
                        images.append({
                            "id": f"img-{len(images) + 1:03d}",
                            "mime_type": "image/png",
                            "data": img_data,
                        })

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
        code = '''
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
'''
        result = await self.execute(code, timeout=10)
        if result["success"] and result["outputs"]:
            for output in result["outputs"]:
                if output["type"] == "stdout":
                    try:
                        import json
                        return json.loads(output["text"].strip())
                    except (json.JSONDecodeError, KeyError):
                        pass
        return []

    async def get_variable(self, name: str) -> Optional[dict]:
        """指定した変数の詳細を取得"""
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
            for output in result["outputs"]:
                if output["type"] == "stdout":
                    try:
                        import json
                        data = json.loads(output["text"].strip())
                        return data
                    except (json.JSONDecodeError, KeyError):
                        pass
        return None
