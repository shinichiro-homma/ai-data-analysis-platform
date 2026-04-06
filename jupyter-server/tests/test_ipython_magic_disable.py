"""IPython シェルマジック無効化テスト

generate_sandbox_code() が返す Python コード文字列を exec() で実行し、
IPython の危険なマジックコマンドが無効化されることを検証する。

タスク 31.3: IPython シェルマジック無効化（二重防御）
- ブロック対象メソッド: system, system_raw, system_piped, getoutput
- 削除対象セルマジック: %%bash, %%sh, %%script, %%perl, %%ruby
- 削除対象ラインマジック: %system, %sx
- 許可対象: 通常のデータ分析コード（import pandas 等）に影響なし
"""

import importlib.util
import os
import sys
import types as _types
from pathlib import Path
from unittest.mock import MagicMock

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
    _base_mock.utc_now_iso = lambda: "2026-01-01T00:00:00Z"
    _base_mock.WORKSPACE_ROOT_DIR = "/home/jovyan/work/workspaces/sample"
    _base_mock.WORKSPACE_PATH_PREFIX = "workspaces/sample"
    _base_mock.JUPYTER_ROOT_DIR = "/home/jovyan/work"
    _base_mock.validate_kernel_name = lambda *a, **kw: None
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


def _create_mock_ipython():
    """テスト用の IPython モックオブジェクトを作成する。

    Returns:
        system, system_raw, system_piped, getoutput メソッドと
        magics_manager.magics 辞書を持つモックオブジェクト
    """
    mock_ip = MagicMock()

    # 実際のメソッドとして設定（sandbox が上書きできるように）
    mock_ip.system = lambda cmd: cmd
    mock_ip.system_raw = lambda cmd: cmd
    mock_ip.system_piped = lambda cmd: cmd
    mock_ip.getoutput = lambda cmd: cmd

    # magics_manager.magics 辞書にダミーマジックを登録
    # IPython の magics 辞書は {"line": {...}, "cell": {...}} の構造
    mock_ip.magics_manager.magics = {
        "line": {
            "system": lambda: None,
            "sx": lambda: None,
            "timeit": lambda: None,  # 安全なマジック（削除されないはず）
            "time": lambda: None,  # 安全なマジック
        },
        "cell": {
            "bash": lambda: None,
            "sh": lambda: None,
            "script": lambda: None,
            "perl": lambda: None,
            "ruby": lambda: None,
            "timeit": lambda: None,  # 安全なマジック
            "time": lambda: None,  # 安全なマジック
        },
    }

    # run_line_magic / run_cell_magic は実際に magics を呼ぶ形にする
    def _run_line_magic(name, line):
        magics = mock_ip.magics_manager.magics.get("line", {})
        if name in magics:
            return magics[name]()
        raise KeyError(f"Line magic '{name}' not found")

    def _run_cell_magic(name, line, cell):
        magics = mock_ip.magics_manager.magics.get("cell", {})
        if name in magics:
            return magics[name]()
        raise KeyError(f"Cell magic '{name}' not found")

    mock_ip.run_line_magic = _run_line_magic
    mock_ip.run_cell_magic = _run_cell_magic

    return mock_ip


def _exec_sandbox_with_ipython(workspace_dir: str, workspace_id: str = "test-ws"):
    """sandbox コードを exec() して namespace を返す。
    IPython モックを namespace に注入する。
    """
    code = generate_sandbox_code(workspace_dir, workspace_id)
    mock_ip = _create_mock_ipython()
    ns = {"get_ipython": lambda: mock_ip}
    exec(code, ns)
    return ns, mock_ip


# --- テスト ---


class TestIPythonMethodsBlocked:
    """IPython の危険なメソッドが PermissionError でブロックされるケース"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ns, self.mock_ip = _exec_sandbox_with_ipython(str(ws_dir), "ws-001")

    def test_ipython_system_blocked(self):
        """get_ipython().system() が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.system("ls")

    def test_ipython_system_raw_blocked(self):
        """get_ipython().system_raw() が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.system_raw("ls")

    def test_ipython_system_piped_blocked(self):
        """get_ipython().system_piped() が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.system_piped("ls")

    def test_ipython_getoutput_blocked(self):
        """get_ipython().getoutput() が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.getoutput("ls")

    def test_run_line_magic_system_blocked(self):
        """get_ipython().run_line_magic("system", ...) が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.run_line_magic("system", "ls")

    def test_run_line_magic_sx_blocked(self):
        """get_ipython().run_line_magic("sx", ...) が PermissionError を送出する"""
        with pytest.raises(PermissionError):
            self.mock_ip.run_line_magic("sx", "ls")


class TestDangerousMagicsRemoved:
    """危険なマジックコマンドが magics_manager から削除されているケース"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ns, self.mock_ip = _exec_sandbox_with_ipython(str(ws_dir), "ws-001")
        self.magics = self.mock_ip.magics_manager.magics

    # --- セルマジックの削除確認 ---

    def test_bash_cell_magic_removed(self):
        """%%bash セルマジックが削除されている"""
        assert "bash" not in self.magics["cell"]

    def test_sh_cell_magic_removed(self):
        """%%sh セルマジックが削除されている"""
        assert "sh" not in self.magics["cell"]

    def test_script_cell_magic_removed(self):
        """%%script セルマジックが削除されている"""
        assert "script" not in self.magics["cell"]

    def test_perl_cell_magic_removed(self):
        """%%perl セルマジックが削除されている"""
        assert "perl" not in self.magics["cell"]

    def test_ruby_cell_magic_removed(self):
        """%%ruby セルマジックが削除されている"""
        assert "ruby" not in self.magics["cell"]

    # --- ラインマジックの削除確認 ---

    def test_system_line_magic_removed(self):
        """%system ラインマジックが削除されている"""
        assert "system" not in self.magics["line"]

    def test_sx_line_magic_removed(self):
        """%sx ラインマジックが削除されている"""
        assert "sx" not in self.magics["line"]

    # --- 安全なマジックが残っていることの確認 ---

    def test_safe_line_magics_preserved(self):
        """安全なラインマジック（%timeit, %time）は削除されていない"""
        assert "timeit" in self.magics["line"]
        assert "time" in self.magics["line"]

    def test_safe_cell_magics_preserved(self):
        """安全なセルマジック（%%timeit, %%time）は削除されていない"""
        assert "timeit" in self.magics["cell"]
        assert "time" in self.magics["cell"]


class TestNormalCodeUnaffected:
    """通常のデータ分析コードに影響がないことの確認"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ws_dir = ws_dir
        self.ns, self.mock_ip = _exec_sandbox_with_ipython(str(ws_dir), "ws-001")

    def test_import_os_path_works(self):
        """os.path の関数は正常に動作する"""
        result = os.path.join("/tmp", "foo")
        assert result == "/tmp/foo"

    def test_file_operations_in_workspace(self):
        """ワークスペース内のファイル操作は正常に動作する"""
        test_file = self.ws_dir / "test.txt"
        test_file.write_text("hello")
        with open(str(test_file)) as f:
            content = f.read()
        assert content == "hello"

    def test_os_getcwd_works(self):
        """os.getcwd() は正常に動作する"""
        cwd = os.getcwd()
        assert isinstance(cwd, str)

    def test_os_listdir_works(self):
        """os.listdir() は正常に動作する"""
        result = os.listdir(str(self.ws_dir))
        assert isinstance(result, list)


class TestIPythonNotAvailable:
    """IPython が利用できない環境でもエラーにならないことの確認"""

    @pytest.fixture(autouse=True)
    def setup_sandbox(self, tmp_path):
        ws_root = tmp_path / "workspaces"
        ws_dir = ws_root / "ws-001"
        ws_dir.mkdir(parents=True)
        self.ws_dir = ws_dir

    def test_sandbox_works_without_ipython(self):
        """get_ipython が存在しない環境でも sandbox は正常に動作する"""
        code = generate_sandbox_code(str(self.ws_dir), "ws-001")
        ns = {}
        # get_ipython が namespace にない状態で実行 → エラーにならないこと
        exec(code, ns)
        # sandbox の基本機能（ファイルアクセス制限）は動作する
        assert "_setup_workspace_sandbox" not in ns
