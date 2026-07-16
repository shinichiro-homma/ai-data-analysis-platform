"""コード検証モジュール

Python AST を用いてコードの静的解析を行い、
データ分析に不要な危険モジュール・関数の使用をブロックする。
"""

import ast
import re
from dataclasses import dataclass


@dataclass
class CodeValidationResult:
    """コード検証の結果"""

    valid: bool
    error: str | None = None
    blocked_item: str | None = None


# データ分析で許可するモジュール
ALLOWED_MODULES = {
    # データ処理
    "pandas",
    "numpy",
    "polars",
    # 可視化
    "matplotlib",
    "seaborn",
    "plotly",
    "japanize_matplotlib",
    # 機械学習
    "sklearn",
    "scipy",
    "lightgbm",
    "xgboost",
    # 標準ライブラリ（安全なもの）
    "json",
    "re",
    "math",
    "datetime",
    "collections",
    "itertools",
    "functools",
    "operator",
    "string",
    "decimal",
    "fractions",
    "statistics",
    "random",
    "copy",
    "pprint",
    "textwrap",
    "unicodedata",
    "typing",
    "dataclasses",
    "enum",
    "abc",
    "io",
    "csv",
    "pathlib",
    "glob",
    "warnings",
    "logging",
    "time",
    "gc",
    # DB接続
    "sqlalchemy",
    "psycopg2",
    "pymysql",
    # ユーティリティ
    "sqlparse",
    "dotenv",
    # IPython（カーネル内で使用される）
    "IPython",
    # Python 将来の互換性
    "__future__",
}

# os モジュールの許可する属性（os は特別扱い）
ALLOWED_OS_ATTRIBUTES = {
    "path",
    "sep",
    "linesep",
    "getcwd",
    "listdir",
    "stat",
    "fspath",
    "PathLike",
    "environ",
}


# 危険な組み込み関数
BLOCKED_BUILTINS = {"eval", "exec", "__import__", "getattr", "setattr", "compile", "globals", "locals", "vars"}

# 危険な属性アクセス
BLOCKED_DUNDER_ATTRS = {
    "__subclasses__",
    "__bases__",
    "__mro__",
    "__globals__",
    "__builtins__",
    "__code__",
    "__closure__",
    "__dict__",
}

# get_ipython() の危険なメソッド
BLOCKED_IPYTHON_METHODS = {"system", "run_line_magic", "run_cell_magic", "run_cell"}

# 危険な %magic コマンド
BLOCKED_PERCENT_MAGICS = {"system", "sx", "run"}

# 危険な %%cell magic コマンド（シェル実行）
BLOCKED_CELL_MAGICS = {"bash", "sh", "system", "sx", "perl", "ruby", "script"}


def _get_top_module(name: str) -> str:
    """モジュール名のトップレベル部分を取得する。例: 'os.path' → 'os'"""
    return name.split(".")[0]


def _block_result(error: str, blocked_item: str) -> CodeValidationResult:
    """ブロック結果を生成するヘルパー関数"""
    return CodeValidationResult(valid=False, error=error, blocked_item=blocked_item)


def _check_import(node: ast.Import) -> CodeValidationResult | None:
    """ast.Import ノードを検査する"""
    for alias in node.names:
        top = _get_top_module(alias.name)
        if top == "os":
            # os をエイリアス付きでインポートすると属性チェックを回避できるためブロック
            if alias.asname and alias.asname != "os":
                return _block_result(f"Blocked import: import os as {alias.asname}", alias.name)
            # os.submodule インポートの場合、許可されていないサブモジュールはブロック
            parts = alias.name.split(".")
            if len(parts) >= 2:
                sub = parts[1]
                if sub not in ALLOWED_OS_ATTRIBUTES:
                    return _block_result(f"Blocked import: {alias.name}", alias.name)
            # os 単体インポートは許可（後続の属性アクセスで検査）
            continue
        if top not in ALLOWED_MODULES:
            return _block_result(f"Blocked import: {alias.name}", alias.name)
    return None


def _check_import_from(node: ast.ImportFrom) -> CodeValidationResult | None:
    """ast.ImportFrom ノードを検査する"""
    module = node.module or ""
    top = _get_top_module(module)

    if top == "os":
        # from os import xxx の場合、許可リストにないものはすべてブロック
        for alias in node.names:
            attr = alias.name
            if attr not in ALLOWED_OS_ATTRIBUTES:
                return _block_result(f"Blocked import: from os import {attr}", f"os.{attr}")
        return None

    if top not in ALLOWED_MODULES:
        return _block_result(f"Blocked import: from {module} import ...", module)
    return None


def _check_call(node: ast.Call) -> CodeValidationResult | None:
    """ast.Call ノードを検査する（危険な関数呼び出し）"""
    # eval(), exec(), __import__(), compile(), globals(), locals() 等
    if isinstance(node.func, ast.Name):
        name = node.func.id
        if name in BLOCKED_BUILTINS:
            return _block_result(f"Blocked function call: {name}()", name)

    # get_ipython().system() 等
    if isinstance(node.func, ast.Attribute):
        attr = node.func.attr
        value = node.func.value
        # get_ipython().xxx()
        if (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "get_ipython"
            and attr in BLOCKED_IPYTHON_METHODS
        ):
            return _block_result(
                f"Blocked IPython method: get_ipython().{attr}()",
                f"get_ipython().{attr}",
            )

    return None


def _check_attribute(node: ast.Attribute) -> CodeValidationResult | None:
    """ast.Attribute ノードを検査する（危険な属性アクセス）"""
    attr = node.attr

    # 危険な dunder 属性
    if attr in BLOCKED_DUNDER_ATTRS:
        return _block_result(f"Blocked attribute access: {attr}", attr)

    # os 属性のホワイトリスト検査: 許可リスト外の属性アクセスをブロック
    if isinstance(node.value, ast.Name) and node.value.id == "os" and attr not in ALLOWED_OS_ATTRIBUTES:
        return _block_result(f"Blocked os function: os.{attr}", f"os.{attr}")

    return None


def _check_ipython_magic(code: str) -> CodeValidationResult | None:
    """IPython マジックコマンド（%magic, %%magic, !shell）を検査する"""
    lines = code.splitlines()
    for line in lines:
        stripped = line.strip()

        # !command または ! command
        if stripped.startswith("!"):
            return _block_result("Blocked shell escape: ! command", "!")

        # %%! セルマジック
        if stripped.startswith("%%!"):
            return _block_result("Blocked cell magic: %%!", "%%!")

        # %%magic セルマジック（%%bash, %%sh 等）
        if stripped.startswith("%%"):
            cell_magic_match = re.match(r"^%%(\w+)", stripped)
            if cell_magic_match:
                cell_magic_name = cell_magic_match.group(1)
                if cell_magic_name in BLOCKED_CELL_MAGICS:
                    return _block_result(
                        f"Blocked cell magic: %%{cell_magic_name}",
                        f"%%{cell_magic_name}",
                    )

        # %magic コマンド
        elif stripped.startswith("%"):
            # %system, %sx 等の危険なマジック
            magic_match = re.match(r"^%(\w+)", stripped)
            if magic_match:
                magic_name = magic_match.group(1)
                if magic_name in BLOCKED_PERCENT_MAGICS:
                    return _block_result(f"Blocked magic command: %{magic_name}", f"%{magic_name}")

    return None


def validate_code(code: str) -> CodeValidationResult:
    """コードを検証し、危険なパターンがないかチェックする。

    Args:
        code: 検証対象の Python コード

    Returns:
        CodeValidationResult: 検証結果
    """
    # 空コードは許可
    if not code or not code.strip():
        return CodeValidationResult(valid=True)

    # IPython マジック（%magic, !shell 等）を先に検査
    # ast.parse 前に行う（マジックは Python 構文ではないため）
    magic_result = _check_ipython_magic(code)
    if magic_result is not None:
        return magic_result

    # AST パース
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return CodeValidationResult(valid=False, error=f"Syntax error: {e}", blocked_item=None)

    # 全ノードを走査
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            result = _check_import(node)
            if result is not None:
                return result

        elif isinstance(node, ast.ImportFrom):
            result = _check_import_from(node)
            if result is not None:
                return result

        elif isinstance(node, ast.Call):
            result = _check_call(node)
            if result is not None:
                return result

        elif isinstance(node, ast.Attribute):
            result = _check_attribute(node)
            if result is not None:
                return result

    return CodeValidationResult(valid=True)
