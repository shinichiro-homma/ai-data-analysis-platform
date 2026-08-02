"""workspace_sandbox の generate_sandbox_code() テスト

generate_sandbox_code() が返す Python コード文字列を exec() で実行し、
monkey patch が正しく設定されることを検証する。

タスク 31.2: sandbox 強化（二重防御）
- ブロック対象: os.system, os.popen, os.execvp, os.spawnlp,
  subprocess.run/Popen/call/check_output/check_call,
  asyncio.create_subprocess_exec/shell, os.posix_spawn
- 許可対象: os.path.join, os.path.exists, os.getcwd, os.environ.get, os.listdir
- 回帰テスト: ワークスペース外ファイルアクセス制限が引き続き動作する
"""

import builtins
import importlib.util
import io
import os
import sys
import tempfile
import types as _types
from pathlib import Path

import pytest

# --- workspace_sandbox モジュールの直接ロード ---
# custom_api パッケージの __init__.py を経由せず、純粋関数のみテストする

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"

# custom_api パッケージ構造の構築（未登録の場合のみ）
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# base モジュールのモック（インポート時に必要）
if "custom_api.base" not in sys.modules:
    _base_mock = _types.ModuleType("custom_api.base")
    _base_mock.__package__ = "custom_api"
    _base_mock.BaseCustomHandler = type("BaseCustomHandler", (), {})
    _base_mock.resolve_workspace_dir = lambda *a, **kw: None
    _base_mock.validate_timeout = lambda *a, **kw: (30, None)
    _base_mock.validate_workspace_id = lambda *a, **kw: None
    _base_mock.workspace_contents_path = lambda *a, **kw: ""
    sys.modules["custom_api.base"] = _base_mock

# workspace_sandbox モジュールをロード
_module_path = _ext_dir / "custom_api" / "workspace_sandbox.py"
spec = importlib.util.spec_from_file_location(
    "custom_api.workspace_sandbox",
    _module_path,
    submodule_search_locations=[],
)
_ws_sandbox = importlib.util.module_from_spec(spec)
_ws_sandbox.__package__ = "custom_api"
sys.modules["custom_api.workspace_sandbox"] = _ws_sandbox
spec.loader.exec_module(_ws_sandbox)

generate_sandbox_code = _ws_sandbox.generate_sandbox_code


# --- ヘルパー ---


def _exec_sandbox(workspace_dir: str, workspace_id: str = "test-ws") -> dict:
    """sandbox コードを exec() して namespace を返す"""
    code = generate_sandbox_code(workspace_dir, workspace_id)
    ns = {}
    exec(code, ns)
    return ns


# --- テスト ---


class TestShellCommandBlocked:
    """シェルコマンド実行が PermissionError でブロックされるケース"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        """各テストの前に sandbox を設定する"""
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ns = _exec_sandbox(str(ws_dir), "ws-001")
        # sandbox 内で import された os, subprocess, asyncio を取得
        self.sandbox_os = self.ns.get("_os") or __import__("os")

    def test_os_system_blocked(self):
        with pytest.raises(PermissionError, match="shell command"):
            os.system("echo hello")

    def test_os_popen_blocked(self):
        with pytest.raises(PermissionError, match="shell command"):
            os.popen("echo hello")

    def test_os_execvp_blocked(self):
        # os.execvp は未パッチだとプロセスを置換してテストプロセスが死ぬため、
        # sandbox が os.execvp を置換済みかチェックし、置換済みなら呼び出して検証する
        # 未置換（Red フェーズ）の場合は pytest.fail で安全に失敗させる
        _original_execvp = os.execvp.__name__ if hasattr(os.execvp, "__name__") else ""
        if _original_execvp == "execvp":
            # sandbox による置換が未実施 → 実際に呼ぶとプロセスが死ぬので安全に失敗
            pytest.fail("os.execvp should be monkey-patched by sandbox to raise PermissionError")
        else:
            # sandbox により置換済み → 呼び出して PermissionError を検証
            with pytest.raises(PermissionError, match="shell command"):
                os.execvp("/bin/true", ["/bin/true"])

    def test_os_spawnlp_blocked(self):
        with pytest.raises(PermissionError, match="shell command"):
            os.spawnlp(os.P_WAIT, "true", "true")

    def test_subprocess_run_blocked(self):
        import subprocess

        with pytest.raises(PermissionError, match="shell command"):
            subprocess.run(["true"])

    def test_subprocess_popen_blocked(self):
        import subprocess

        with pytest.raises(PermissionError, match="shell command"):
            subprocess.Popen(["true"])

    def test_subprocess_call_blocked(self):
        import subprocess

        with pytest.raises(PermissionError, match="shell command"):
            subprocess.call(["true"])

    def test_subprocess_check_output_blocked(self):
        import subprocess

        with pytest.raises(PermissionError, match="shell command"):
            subprocess.check_output(["true"])

    def test_subprocess_check_call_blocked(self):
        import subprocess

        with pytest.raises(PermissionError, match="shell command"):
            subprocess.check_call(["true"])

    def test_asyncio_create_subprocess_exec_blocked(self):
        import asyncio

        async def _run():
            await asyncio.create_subprocess_exec("true")

        with pytest.raises(PermissionError, match="shell command"):
            asyncio.run(_run())

    def test_asyncio_create_subprocess_shell_blocked(self):
        import asyncio

        async def _run():
            await asyncio.create_subprocess_shell("true")

        with pytest.raises(PermissionError, match="shell command"):
            asyncio.run(_run())

    def test_os_posix_spawn_blocked(self):
        if not hasattr(os, "posix_spawn"):
            pytest.skip("os.posix_spawn not available on this platform")
        with pytest.raises(PermissionError, match="shell command"):
            os.posix_spawn("/usr/bin/true", ["/usr/bin/true"], os.environ)


class TestSafeFunctionsAllowed:
    """安全な os 関数が引き続き動作するケース"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ws_dir = ws_dir
        self.ns = _exec_sandbox(str(ws_dir), "ws-001")

    def test_os_path_join(self):
        result = os.path.join("/tmp", "foo", "bar")
        assert result == "/tmp/foo/bar"

    def test_os_path_exists(self):
        # /tmp は存在するはず
        result = os.path.exists("/tmp")
        assert result is True

    def test_os_getcwd(self):
        result = os.getcwd()
        assert isinstance(result, str)

    def test_os_environ_get(self):
        result = os.environ.get("PATH")
        assert result is not None

    def test_os_listdir(self):
        result = os.listdir(str(self.ws_dir))
        assert isinstance(result, list)


class TestWorkspaceFileAccessRegression:
    """既存機能の回帰テスト: ワークスペース外ファイルアクセス制限"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        self.ws_dir = ws_root / "ws-001"
        self.other_ws = ws_root / "ws-002"
        self.ws_dir.mkdir(parents=True)
        self.other_ws.mkdir(parents=True)
        # 他ワークスペースにファイルを作成
        (self.other_ws / "secret.txt").write_text("secret data")
        # 自ワークスペースにファイルを作成
        (self.ws_dir / "my_file.txt").write_text("my data")
        self.ns = _exec_sandbox(str(self.ws_dir), "ws-001")

    def test_own_workspace_file_readable(self):
        """自分のワークスペースのファイルは読める"""
        with open(str(self.ws_dir / "my_file.txt")) as f:
            content = f.read()
        assert content == "my data"

    def test_other_workspace_file_blocked(self):
        """他のワークスペースのファイルは PermissionError"""
        with pytest.raises(PermissionError, match="another workspace"), open(str(self.other_ws / "secret.txt")):
            pass

    def test_system_file_allowed(self):
        """システムファイル（ワークスペースルート外）はアクセス可能"""
        # /tmp はワークスペースルート外なのでアクセス可能
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
            f.write("temp data")
            temp_path = f.name
        try:
            with open(temp_path) as f:
                content = f.read()
            assert content == "temp data"
        finally:
            os.unlink(temp_path)

    def test_pathlib_other_workspace_blocked(self):
        """pathlib 経由の他ワークスペースアクセスも PermissionError"""
        p = Path(self.other_ws / "secret.txt")
        with pytest.raises(PermissionError, match="another workspace"):
            p.read_text()

    def test_chdir_to_other_workspace_blocked(self):
        """他のワークスペースへの chdir は PermissionError"""
        with pytest.raises(PermissionError, match="another workspace"):
            os.chdir(str(self.other_ws))


class TestFileRenameBlocked:
    """os.rename / os.replace のワークスペース境界チェック"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        self.ws_dir = ws_root / "ws-001"
        self.other_ws = ws_root / "ws-002"
        self.ws_dir.mkdir(parents=True)
        self.other_ws.mkdir(parents=True)
        # 自ワークスペースにファイルを作成
        (self.ws_dir / "source.txt").write_text("source data")
        # 他ワークスペースにファイルを作成
        (self.other_ws / "target.txt").write_text("target data")
        self.ns = _exec_sandbox(str(self.ws_dir), "ws-001")

    def test_rename_to_other_workspace_blocked(self):
        """自 WS から他 WS への rename は PermissionError"""
        src = str(self.ws_dir / "source.txt")
        dst = str(self.other_ws / "moved.txt")
        with pytest.raises(PermissionError, match="another workspace"):
            os.rename(src, dst)

    def test_rename_from_other_workspace_blocked(self):
        """他 WS から自 WS への rename は PermissionError"""
        src = str(self.other_ws / "target.txt")
        dst = str(self.ws_dir / "moved.txt")
        with pytest.raises(PermissionError, match="another workspace"):
            os.rename(src, dst)

    def test_rename_within_workspace_allowed(self):
        """自 WS 内の rename は成功する"""
        src = str(self.ws_dir / "source.txt")
        dst = str(self.ws_dir / "renamed.txt")
        os.rename(src, dst)
        assert os.path.exists(dst)
        assert not os.path.exists(src)

    def test_replace_to_other_workspace_blocked(self):
        """自 WS から他 WS への replace は PermissionError"""
        src = str(self.ws_dir / "source.txt")
        dst = str(self.other_ws / "target.txt")
        with pytest.raises(PermissionError, match="another workspace"):
            os.replace(src, dst)

    def test_replace_from_other_workspace_blocked(self):
        """他 WS から自 WS への replace は PermissionError"""
        src = str(self.other_ws / "target.txt")
        dst = str(self.ws_dir / "replaced.txt")
        with pytest.raises(PermissionError, match="another workspace"):
            os.replace(src, dst)

    def test_replace_within_workspace_allowed(self):
        """自 WS 内の replace は成功する"""
        (self.ws_dir / "dest.txt").write_text("old data")
        src = str(self.ws_dir / "source.txt")
        dst = str(self.ws_dir / "dest.txt")
        os.replace(src, dst)
        assert os.path.exists(dst)
        assert not os.path.exists(src)


class TestBuiltinsRestoredBetweenTests:
    """conftest の restore_sandbox_patched_globals が builtins も巻き戻すことの検証

    sandbox コードは `import builtins as _b` → `_b.open = _sandbox_open` で
    プロセス全体の builtins.open を差し替える（workspace_sandbox.py:49,119）。
    conftest の autouse フィクスチャがこれを復元しないと、以降の全テスト
    （ファイルを跨ぐ）がパッチされた open を掴んだまま走る。

    pytest はファイル内のテストを定義順に実行するため、
    「1 つ目で exec → 2 つ目で復元済みを assert」という順序で汚染を検知する。
    io.open は sandbox が触らない、パッチ前の組み込み open と同一のオブジェクト。
    """

    # 1 つ目のテストが作った他ワークスペースのファイル。3 つ目のテストが参照する
    leaked_other_ws_file: str | None = None

    def test_sandbox_patches_builtins_open(self, tmp_path):
        """前提の確認: sandbox コードの exec は builtins.open を差し替える"""
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        other_ws = ws_root / "ws-002"
        ws_dir.mkdir(parents=True)
        other_ws.mkdir(parents=True)
        other_file = other_ws / "secret.txt"
        other_file.write_text("secret data")
        # 後続テストが「漏れた制限」を検知できるよう、exec 前にパスを共有する
        type(self).leaked_other_ws_file = str(other_file)

        assert builtins.open is io.open, "テスト開始時点で builtins.open が汚染されている"

        _exec_sandbox(str(ws_dir), "ws-001")

        assert builtins.open is not io.open
        assert builtins.open.__name__ == "_sandbox_open"

    def test_builtins_open_restored_after_sandbox_test(self):
        """前テストの sandbox パッチがテスト境界を越えて漏れていない"""
        assert builtins.open is io.open, (
            f"builtins.open が組み込みに復元されていない: {builtins.open!r}。"
            "conftest の _SANDBOX_PATCHED_MODULES に builtins が含まれているか確認する"
        )

    def test_other_workspace_of_previous_test_readable(self):
        """機能面の確認: 前テストの sandbox が課した制限が本テストに残っていない

        復元されていなければ、漏れた _sandbox_open が前テストの
        ワークスペースルート配下の他 WS パスを PermissionError で拒否する。
        """
        assert self.leaked_other_ws_file is not None, "先行テストが実行されていない"

        with open(self.leaked_other_ws_file) as f:
            assert f.read() == "secret data"
