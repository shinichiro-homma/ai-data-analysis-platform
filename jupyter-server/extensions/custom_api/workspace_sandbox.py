"""
ワークスペースサンドボックスコード生成モジュール

カーネルに注入する Python コードを生成し、他のワークスペースディレクトリへの
ファイルアクセスおよびディレクトリ移動を PermissionError で拒否する
「ソフトな制限」を実装する。

制限対象:
- builtins.open(): 他ワークスペースパスへのアクセスを拒否
- os.chdir(): 他ワークスペースへのディレクトリ移動を拒否
- pathlib.Path のファイル操作メソッド: 同様に制限

拒否条件（デニーリスト方式）:
- ワークスペースルート配下であり、かつ現在のワークスペース配下でないパス

許可範囲:
- 現在のワークスペースディレクトリ配下
- ワークスペースルート外の全パス（/tmp、/proc、システムファイル、Python ライブラリ等）
"""

import json
import os


def generate_sandbox_code(workspace_dir: str, workspace_id: str) -> str:
    """
    ワークスペースサンドボックスを設定する Python コードを生成する。

    このコードをカーネルで実行することで、builtins.open と os.chdir が
    他のワークスペースディレクトリへのアクセスを PermissionError で拒否する。

    デニーリスト方式: ワークスペースルート配下の他 WS ディレクトリのみを拒否し、
    /tmp、/proc、Python ライブラリ等のシステムパスは許可する。

    Args:
        workspace_dir: 現在のワークスペースディレクトリの絶対パス
        workspace_id: ワークスペースID（ワークスペース固有の一時ディレクトリ名に使用）

    Returns:
        カーネルで実行するサンドボックス設定コード
    """
    workspace_dir_literal = json.dumps(workspace_dir)
    workspace_root = os.path.dirname(workspace_dir)
    workspace_root_literal = json.dumps(workspace_root)
    workspace_tmp_dir_literal = json.dumps(f"/tmp/ws-{workspace_id}")

    return f"""
def _setup_workspace_sandbox():
    import builtins as _b
    import os as _os
    import pathlib as _pl

    _WORKSPACE_DIR = {workspace_dir_literal}
    _WORKSPACE_ROOT = {workspace_root_literal}
    _TMP_DIR = {workspace_tmp_dir_literal}

    # ワークスペース固有の一時ディレクトリを作成
    _os.makedirs(_TMP_DIR, exist_ok=True)

    _orig_open = _b.open
    _orig_chdir = _os.chdir

    def _is_denied(path_str):
        abs_path = _os.path.realpath(_os.path.abspath(str(path_str)))
        workspace_root_real = _os.path.realpath(_WORKSPACE_ROOT)
        workspace_real = _os.path.realpath(_WORKSPACE_DIR)

        # ワークスペースルート配下でなければ許可（/tmp、/proc、システムファイル等）
        is_under_root = (
            abs_path == workspace_root_real
            or abs_path.startswith(workspace_root_real + _os.sep)
        )
        if not is_under_root:
            return False

        # 現在のワークスペース配下は許可
        if abs_path == workspace_real or abs_path.startswith(workspace_real + _os.sep):
            return False

        # 他のワークスペース（ワークスペースルート配下で現在の WS 以外）は拒否
        return True

    def _deny(path):
        raise PermissionError(
            f"Access denied: path is in another workspace: {{path}}"
        )

    def _sandbox_open(file, *args, **kwargs):
        if isinstance(file, (str, bytes, _os.PathLike)):
            path_str = _os.fsdecode(file) if isinstance(file, bytes) else str(file)
            if _is_denied(path_str):
                _deny(path_str)
        return _orig_open(file, *args, **kwargs)

    def _sandbox_chdir(path):
        if _is_denied(str(path)):
            _deny(path)
        return _orig_chdir(path)

    _orig_rename = _os.rename
    _orig_replace = _os.replace

    def _sandbox_rename(src, dst):
        if _is_denied(str(src)):
            _deny(src)
        if _is_denied(str(dst)):
            _deny(dst)
        return _orig_rename(src, dst)

    def _sandbox_replace(src, dst):
        if _is_denied(str(src)):
            _deny(src)
        if _is_denied(str(dst)):
            _deny(dst)
        return _orig_replace(src, dst)

    _b.open = _sandbox_open
    _os.chdir = _sandbox_chdir
    _os.rename = _sandbox_rename
    _os.replace = _sandbox_replace

    # globals() はカーネルの user_ns を返す。builtins パッチが効かない環境でも
    # user_ns の 'open' がビルトイン検索より先に参照されるため、確実に制限できる
    globals()['open'] = _sandbox_open

    _orig_path_open = _pl.Path.open
    _orig_path_read_text = _pl.Path.read_text
    _orig_path_read_bytes = _pl.Path.read_bytes
    _orig_path_write_text = _pl.Path.write_text
    _orig_path_write_bytes = _pl.Path.write_bytes

    def _assert_path_allowed(self):
        if _is_denied(str(self)):
            _deny(self)

    def _make_sandboxed(orig):
        def _wrapper(self, *a, **k):
            _assert_path_allowed(self)
            return orig(self, *a, **k)
        return _wrapper

    _pl.Path.open = _make_sandboxed(_orig_path_open)
    _pl.Path.read_text = _make_sandboxed(_orig_path_read_text)
    _pl.Path.read_bytes = _make_sandboxed(_orig_path_read_bytes)
    _pl.Path.write_text = _make_sandboxed(_orig_path_write_text)
    _pl.Path.write_bytes = _make_sandboxed(_orig_path_write_bytes)

    # --- シェルコマンド実行のブロック（二重防御）---

    def _blocked(name, is_async=False):
        _msg = f"{{name}}() is blocked: shell command execution is not allowed for security reasons"
        if is_async:
            async def _raise(*args, **kwargs):
                raise PermissionError(_msg)
        else:
            def _raise(*args, **kwargs):
                raise PermissionError(_msg)
        _raise.__name__ = f"_blocked_{{name}}"
        return _raise

    # os モジュールの危険関数をブロック
    _os.system = _blocked("os.system")
    _os.popen = _blocked("os.popen")

    for _attr in ("fork", "forkpty", "kill", "killpg"):
        if hasattr(_os, _attr):
            setattr(_os, _attr, _blocked(f"os.{{_attr}}"))

    for _attr in ("execl", "execle", "execlp", "execlpe", "execv", "execve", "execvp", "execvpe"):
        if hasattr(_os, _attr):
            setattr(_os, _attr, _blocked(f"os.{{_attr}}"))

    for _attr in ("spawnl", "spawnle", "spawnlp", "spawnlpe", "spawnv", "spawnve", "spawnvp", "spawnvpe"):
        if hasattr(_os, _attr):
            setattr(_os, _attr, _blocked(f"os.{{_attr}}"))

    for _attr in ("posix_spawn", "posix_spawnp"):
        if hasattr(_os, _attr):
            setattr(_os, _attr, _blocked(f"os.{{_attr}}"))

    # subprocess モジュールをブロック
    import subprocess as _sp
    _sp.Popen = _blocked("subprocess.Popen")
    _sp.run = _blocked("subprocess.run")
    _sp.call = _blocked("subprocess.call")
    _sp.check_output = _blocked("subprocess.check_output")
    _sp.check_call = _blocked("subprocess.check_call")
    _sp.getoutput = _blocked("subprocess.getoutput")
    _sp.getstatusoutput = _blocked("subprocess.getstatusoutput")

    # asyncio のサブプロセス関数をブロック
    import asyncio as _aio
    _aio.create_subprocess_exec = _blocked("asyncio.create_subprocess_exec", is_async=True)
    _aio.create_subprocess_shell = _blocked("asyncio.create_subprocess_shell", is_async=True)

    # --- IPython シェルマジック無効化（レイヤー4: 二重防御） ---
    try:
        _ip = get_ipython()

        # system/system_raw/system_piped/getoutput を無効化
        _ip.system = _blocked("IPython.system")
        _ip.system_raw = _blocked("IPython.system_raw")
        _ip.system_piped = _blocked("IPython.system_piped")
        _ip.getoutput = _blocked("IPython.getoutput")

        # ブロック対象のラインマジック（run_line_magic フィルタ兼 magics_manager 削除対象）
        _dangerous_line_magics = {{"system", "sx", "run"}}

        # run_line_magic の元の関数を保持して、危険なラインマジックのみブロック
        _orig_run_line_magic = _ip.run_line_magic
        def _safe_run_line_magic(magic_name, line, _stack_depth=1):
            if magic_name in _dangerous_line_magics:
                raise PermissionError(f"IPython %{{magic_name}} is blocked: shell command execution is not allowed")
            return _orig_run_line_magic(magic_name, line)
        _ip.run_line_magic = _safe_run_line_magic

        # 危険なセルマジック/ラインマジックを magics_manager から削除
        _dangerous_cell_magics = {{"bash", "sh", "script", "perl", "ruby", "system", "sx"}}

        if hasattr(_ip, 'magics_manager'):
            _mm = _ip.magics_manager
            if hasattr(_mm, 'magics') and isinstance(_mm.magics, dict):
                if 'cell' in _mm.magics:
                    for _m in _dangerous_cell_magics:
                        _mm.magics['cell'].pop(_m, None)
                if 'line' in _mm.magics:
                    for _m in _dangerous_line_magics:
                        _mm.magics['line'].pop(_m, None)
    except NameError:
        pass  # get_ipython() が存在しない環境（テスト等）

_setup_workspace_sandbox()
del _setup_workspace_sandbox
"""
