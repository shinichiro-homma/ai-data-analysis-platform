"""validate_code() の純粋関数テスト

code_validator.py はデータ分析コードの静的解析を行う純粋関数モジュール。
外部依存がないため、モジュール直接ロード方式でインポートする。
"""

import importlib.util
import sys
import types as _types
from pathlib import Path

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"

# --- 1. custom_api パッケージ構造の構築 ---
# 相対インポートが動くよう、パッケージを手動構築（必要な場合）
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# --- 2. code_validator をパッケージ内モジュールとしてロード ---
_module_path = _ext_dir / "custom_api" / "code_validator.py"
spec = importlib.util.spec_from_file_location(
    "custom_api.code_validator",
    _module_path,
    submodule_search_locations=[],
)
_code_validator = importlib.util.module_from_spec(spec)
_code_validator.__package__ = "custom_api"
sys.modules["custom_api.code_validator"] = _code_validator
spec.loader.exec_module(_code_validator)

validate_code = _code_validator.validate_code
CodeValidationResult = _code_validator.CodeValidationResult


# ============================================================
# 正常系: 許可されるコード
# ============================================================


class TestAllowedImports:
    """データ分析で使用される標準的なインポートが許可されること"""

    def test_import_pandas(self):
        result = validate_code("import pandas as pd")
        assert result.valid is True
        assert result.error is None

    def test_import_numpy(self):
        result = validate_code("import numpy as np")
        assert result.valid is True
        assert result.error is None

    def test_import_matplotlib(self):
        result = validate_code("import matplotlib.pyplot as plt")
        assert result.valid is True
        assert result.error is None

    def test_from_matplotlib(self):
        result = validate_code("from matplotlib import pyplot")
        assert result.valid is True
        assert result.error is None

    def test_import_seaborn(self):
        result = validate_code("import seaborn as sns")
        assert result.valid is True
        assert result.error is None

    def test_import_sklearn(self):
        result = validate_code("from sklearn.model_selection import train_test_split")
        assert result.valid is True
        assert result.error is None

    def test_import_json(self):
        result = validate_code("import json")
        assert result.valid is True
        assert result.error is None

    def test_import_re(self):
        result = validate_code("import re")
        assert result.valid is True
        assert result.error is None

    def test_import_math(self):
        result = validate_code("import math")
        assert result.valid is True
        assert result.error is None

    def test_import_os_path(self):
        result = validate_code("import os.path")
        assert result.valid is True
        assert result.error is None

    def test_from_os_import_path(self):
        result = validate_code("from os import path")
        assert result.valid is True
        assert result.error is None

    def test_import_datetime(self):
        result = validate_code("import datetime")
        assert result.valid is True
        assert result.error is None

    def test_import_collections(self):
        result = validate_code("import collections")
        assert result.valid is True
        assert result.error is None

    def test_import_itertools(self):
        result = validate_code("import itertools")
        assert result.valid is True
        assert result.error is None

    def test_import_scipy(self):
        result = validate_code("import scipy")
        assert result.valid is True
        assert result.error is None

    def test_import_plotly(self):
        result = validate_code("import plotly.express as px")
        assert result.valid is True
        assert result.error is None

    def test_import_polars(self):
        result = validate_code("import polars as pl")
        assert result.valid is True
        assert result.error is None

    def test_import_sqlalchemy(self):
        result = validate_code("import sqlalchemy")
        assert result.valid is True
        assert result.error is None

    def test_import_lightgbm(self):
        result = validate_code("import lightgbm")
        assert result.valid is True
        assert result.error is None

    def test_import_xgboost(self):
        result = validate_code("import xgboost")
        assert result.valid is True
        assert result.error is None


class TestAllowedCode:
    """通常のデータ分析コードが許可されること"""

    def test_empty_string(self):
        result = validate_code("")
        assert result.valid is True
        assert result.error is None

    def test_whitespace_only(self):
        result = validate_code("   \n\n  ")
        assert result.valid is True
        assert result.error is None

    def test_simple_assignment(self):
        result = validate_code("x = 1 + 2")
        assert result.valid is True

    def test_function_definition(self):
        result = validate_code("def my_func(x):\n    return x * 2")
        assert result.valid is True

    def test_list_comprehension(self):
        result = validate_code("[x**2 for x in range(10)]")
        assert result.valid is True

    def test_multiline_code(self):
        code = """
import pandas as pd
import numpy as np

df = pd.DataFrame({'a': [1, 2, 3]})
result = df.describe()
print(result)
"""
        result = validate_code(code)
        assert result.valid is True

    def test_os_path_join(self):
        """os.path の使用は許可"""
        result = validate_code("import os.path\nos.path.join('/a', 'b')")
        assert result.valid is True

    def test_open_for_reading(self):
        """open() はデータ読み込みに必要なので許可"""
        result = validate_code("f = open('data.csv', 'r')")
        assert result.valid is True

    def test_print_function(self):
        result = validate_code("print('hello')")
        assert result.valid is True

    def test_class_definition(self):
        result = validate_code("class MyClass:\n    pass")
        assert result.valid is True


# ============================================================
# 異常系: 拒否されるインポート
# ============================================================


class TestBlockedImports:
    """危険なモジュールのインポートが拒否されること"""

    def test_import_subprocess(self):
        result = validate_code("import subprocess")
        assert result.valid is False
        assert result.error is not None
        assert result.blocked_item is not None

    def test_from_subprocess(self):
        result = validate_code("from subprocess import run")
        assert result.valid is False
        assert result.error is not None

    def test_import_ctypes(self):
        result = validate_code("import ctypes")
        assert result.valid is False
        assert result.error is not None

    def test_import_cffi(self):
        result = validate_code("import cffi")
        assert result.valid is False
        assert result.error is not None

    def test_import_pty(self):
        result = validate_code("import pty")
        assert result.valid is False
        assert result.error is not None

    def test_import_multiprocessing(self):
        result = validate_code("import multiprocessing")
        assert result.valid is False
        assert result.error is not None

    def test_import_shutil(self):
        result = validate_code("import shutil")
        assert result.valid is False
        assert result.error is not None

    def test_import_socket(self):
        result = validate_code("import socket")
        assert result.valid is False
        assert result.error is not None

    def test_import_http(self):
        result = validate_code("import http")
        assert result.valid is False
        assert result.error is not None

    def test_import_http_server(self):
        result = validate_code("import http.server")
        assert result.valid is False
        assert result.error is not None

    def test_from_http_import(self):
        result = validate_code("from http.server import HTTPServer")
        assert result.valid is False
        assert result.error is not None

    def test_import_asyncio_subprocess(self):
        result = validate_code("import asyncio.subprocess")
        assert result.valid is False
        assert result.error is not None

    def test_import_signal(self):
        result = validate_code("import signal")
        assert result.valid is False
        assert result.error is not None

    def test_import_webbrowser(self):
        result = validate_code("import webbrowser")
        assert result.valid is False
        assert result.error is not None

    def test_import_code(self):
        """code モジュール（対話的インタープリタ）は拒否"""
        result = validate_code("import code")
        assert result.valid is False
        assert result.error is not None

    def test_import_codeop(self):
        result = validate_code("import codeop")
        assert result.valid is False
        assert result.error is not None

    def test_import_importlib(self):
        result = validate_code("import importlib")
        assert result.valid is False
        assert result.error is not None


# ============================================================
# 異常系: os の危険な関数
# ============================================================


class TestBlockedOsFunctions:
    """os モジュールの危険な関数が拒否されること"""

    def test_os_system(self):
        result = validate_code("import os\nos.system('ls')")
        assert result.valid is False
        assert result.error is not None

    def test_os_popen(self):
        result = validate_code("import os\nos.popen('ls')")
        assert result.valid is False
        assert result.error is not None

    def test_from_os_import_system(self):
        result = validate_code("from os import system")
        assert result.valid is False
        assert result.error is not None

    def test_from_os_import_popen(self):
        result = validate_code("from os import popen")
        assert result.valid is False
        assert result.error is not None

    def test_from_os_import_exec(self):
        result = validate_code("from os import execv")
        assert result.valid is False
        assert result.error is not None

    def test_os_remove(self):
        result = validate_code("import os\nos.remove('file.txt')")
        assert result.valid is False
        assert result.error is not None

    def test_os_unlink(self):
        result = validate_code("import os\nos.unlink('file.txt')")
        assert result.valid is False
        assert result.error is not None

    def test_os_rmdir(self):
        result = validate_code("import os\nos.rmdir('/tmp/dir')")
        assert result.valid is False
        assert result.error is not None


# ============================================================
# 異常系: 危険パターン
# ============================================================


class TestBlockedDangerousPatterns:
    """eval, exec, __import__ 等の危険パターンが拒否されること"""

    def test_eval_with_variable(self):
        """eval に変数（動的引数）を渡すのは拒否"""
        result = validate_code("x = 'print(1)'\neval(x)")
        assert result.valid is False
        assert result.error is not None

    def test_eval_with_input(self):
        result = validate_code("eval(input())")
        assert result.valid is False
        assert result.error is not None

    def test_exec_call(self):
        result = validate_code("exec('import os')")
        assert result.valid is False
        assert result.error is not None

    def test_exec_with_variable(self):
        result = validate_code("code = 'import os'\nexec(code)")
        assert result.valid is False
        assert result.error is not None

    def test_dunder_import(self):
        result = validate_code("__import__('subprocess')")
        assert result.valid is False
        assert result.error is not None

    def test_dunder_import_with_variable(self):
        result = validate_code("mod = 'subprocess'\n__import__(mod)")
        assert result.valid is False
        assert result.error is not None

    def test_getattr_on_module(self):
        """getattr でモジュール属性への動的アクセスは拒否"""
        result = validate_code("import os\ngetattr(os, 'system')('ls')")
        assert result.valid is False
        assert result.error is not None

    def test_dunder_subclasses(self):
        result = validate_code("''.__class__.__subclasses__()")
        assert result.valid is False
        assert result.error is not None

    def test_dunder_bases(self):
        result = validate_code("int.__bases__")
        assert result.valid is False
        assert result.error is not None

    def test_dunder_mro(self):
        result = validate_code("int.__mro__")
        assert result.valid is False
        assert result.error is not None

    def test_compile_builtin(self):
        result = validate_code("compile('print(1)', '<string>', 'exec')")
        assert result.valid is False
        assert result.error is not None

    def test_globals_call(self):
        result = validate_code("globals()")
        assert result.valid is False
        assert result.error is not None

    def test_locals_call(self):
        result = validate_code("locals()")
        assert result.valid is False
        assert result.error is not None


# ============================================================
# 異常系: IPython / シェルコマンド
# ============================================================


class TestBlockedIPython:
    """IPython マジックコマンドやシェル実行が拒否されること"""

    def test_shell_escape_ls(self):
        """!ls 形式のシェルエスケープ"""
        result = validate_code("!ls")
        assert result.valid is False
        assert result.error is not None

    def test_shell_escape_cat(self):
        result = validate_code("!cat /etc/passwd")
        assert result.valid is False
        assert result.error is not None

    def test_shell_escape_with_space(self):
        result = validate_code("! ls -la")
        assert result.valid is False
        assert result.error is not None

    def test_get_ipython_system(self):
        result = validate_code("get_ipython().system('ls')")
        assert result.valid is False
        assert result.error is not None

    def test_get_ipython_run_line_magic(self):
        result = validate_code("get_ipython().run_line_magic('system', 'ls')")
        assert result.valid is False
        assert result.error is not None

    def test_percent_system_magic(self):
        """%system マジックコマンド"""
        result = validate_code("%system ls")
        assert result.valid is False
        assert result.error is not None

    def test_percent_sx_magic(self):
        """%sx マジックコマンド（シェル実行の別名）"""
        result = validate_code("%sx ls")
        assert result.valid is False
        assert result.error is not None

    def test_double_percent_bang(self):
        """%%! セルマジック"""
        result = validate_code("%%!\nls -la")
        assert result.valid is False
        assert result.error is not None


# ============================================================
# 異常系: 構文エラー
# ============================================================


class TestSyntaxError:
    """構文エラーのあるコードの扱い"""

    def test_syntax_error_rejected(self):
        """構文エラーのあるコードは拒否される（AST 解析不能）"""
        result = validate_code("def f(\n")
        assert result.valid is False
        assert result.error is not None


# ============================================================
# エラーコード
# ============================================================


class TestErrorCode:
    """ブロック時に適切なエラー情報が返ること"""

    def test_blocked_import_has_blocked_item(self):
        result = validate_code("import subprocess")
        assert result.valid is False
        assert result.blocked_item is not None
        assert "subprocess" in result.blocked_item

    def test_blocked_os_function_has_blocked_item(self):
        result = validate_code("import os\nos.system('ls')")
        assert result.valid is False
        assert result.blocked_item is not None

    def test_blocked_eval_has_blocked_item(self):
        result = validate_code("eval(x)")
        assert result.valid is False
        assert result.blocked_item is not None

    def test_blocked_shell_escape_has_error(self):
        result = validate_code("!ls")
        assert result.valid is False
        assert result.error is not None
