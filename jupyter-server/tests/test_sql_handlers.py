"""_classify_sql と _validate_filename の純粋関数テスト

sql_handlers.py は pandas / sqlalchemy / tornado 等の重い依存を持つため、
パッケージの __init__.py を経由せずにモジュールを直接ロードする。
重い依存はモック、sqlparse のみ実際にインポートする。
"""

import importlib.util
import sys
import types as _types
from pathlib import Path

import pytest

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"

# --- 1. 重い依存のモック ---
# pandas / sqlalchemy / tornado はテスト対象の純粋関数では不要
for _mod_name in ("pandas", "sqlalchemy", "sqlalchemy.exc", "tornado", "tornado.web"):
    if _mod_name not in sys.modules:
        _m = _types.ModuleType(_mod_name)
        if _mod_name == "tornado.web":
            _m.authenticated = lambda f: f
        sys.modules[_mod_name] = _m

# --- 2. custom_api パッケージ構造の構築 ---
# 相対インポート（from .base import ...）が動くよう、パッケージを手動構築
_pkg = _types.ModuleType("custom_api")
_pkg.__path__ = [str(_ext_dir / "custom_api")]
_pkg.__package__ = "custom_api"
sys.modules["custom_api"] = _pkg

# base モジュールのモック（Handler クラス用。純粋関数テストには不要だがインポート時に必要）
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

# --- 3. sql_handlers をパッケージ内モジュールとしてロード ---
_module_path = _ext_dir / "custom_api" / "sql_handlers.py"
spec = importlib.util.spec_from_file_location(
    "custom_api.sql_handlers",
    _module_path,
    submodule_search_locations=[],
)
_sql_handlers = importlib.util.module_from_spec(spec)
_sql_handlers.__package__ = "custom_api"
sys.modules["custom_api.sql_handlers"] = _sql_handlers
spec.loader.exec_module(_sql_handlers)

_classify_sql = _sql_handlers._classify_sql
_validate_filename = _sql_handlers._validate_filename
_normalize_parquet_schema = _sql_handlers._normalize_parquet_schema
SqlClassification = _sql_handlers.SqlClassification

# _validate_export_filename は未実装の可能性がある（TDD Red フェーズ）
_validate_export_filename = getattr(_sql_handlers, "_validate_export_filename", None)


# ============================================================
# _classify_sql テスト
# ============================================================


class TestClassifySqlSelect:
    """SELECT 系のテスト"""

    def test_simple_select(self):
        result = _classify_sql("SELECT * FROM t")
        assert result.is_select is True
        assert result.error is None

    def test_with_cte(self):
        result = _classify_sql("WITH cte AS (SELECT 1) SELECT * FROM cte")
        assert result.is_select is True
        assert result.error is None

    def test_select_with_whitespace(self):
        result = _classify_sql("  SELECT 1  ")
        assert result.is_select is True
        assert result.error is None


class TestClassifySqlAllowedDDL:
    """許可される DDL 系のテスト"""

    def test_create_temp_table(self):
        result = _classify_sql("CREATE TEMP TABLE t AS SELECT 1")
        assert result.is_select is False
        assert result.error is None

    def test_create_temporary_table(self):
        result = _classify_sql("CREATE TEMPORARY TABLE t (id INT)")
        assert result.is_select is False
        assert result.error is None

    def test_create_or_replace_function(self):
        result = _classify_sql("CREATE OR REPLACE FUNCTION f() RETURNS void AS $$ BEGIN END; $$ LANGUAGE plpgsql")
        assert result.is_select is False
        assert result.error is None

    def test_drop_table(self):
        result = _classify_sql("DROP TABLE t")
        assert result.is_select is False
        assert result.error is None

    def test_drop_table_if_exists(self):
        result = _classify_sql("DROP TABLE IF EXISTS t")
        assert result.is_select is False
        assert result.error is None

    def test_drop_function(self):
        result = _classify_sql("DROP FUNCTION f")
        assert result.is_select is False
        assert result.error is None

    # TRUNCATE はブラックリストに移動（TestClassifySqlBlocked.test_truncate）


class TestClassifySqlAllowedDML:
    """許可される DML 系のテスト"""

    def test_insert_into(self):
        result = _classify_sql("INSERT INTO t VALUES (1, 'a')")
        assert result.is_select is False
        assert result.error is None

    def test_update(self):
        result = _classify_sql("UPDATE t SET col = 'val'")
        assert result.is_select is False
        assert result.error is None


class TestClassifySqlTransaction:
    """トランザクション系のテスト"""

    def test_begin(self):
        result = _classify_sql("BEGIN")
        assert result.is_select is False
        assert result.error is None

    def test_commit(self):
        result = _classify_sql("COMMIT")
        assert result.is_select is False
        assert result.error is None

    def test_rollback(self):
        result = _classify_sql("ROLLBACK")
        assert result.is_select is False
        assert result.error is None


class TestClassifySqlBlocked:
    """ブラックリストで拒否されるテスト"""

    def test_delete(self):
        result = _classify_sql("DELETE FROM t")
        assert result.error is not None
        assert "DELETE" in result.error

    def test_alter_table(self):
        result = _classify_sql("ALTER TABLE t ADD COLUMN c INT")
        assert result.error is not None
        assert "ALTER" in result.error

    def test_grant(self):
        result = _classify_sql("GRANT SELECT ON t TO user1")
        assert result.error is not None
        assert "GRANT" in result.error

    def test_revoke(self):
        result = _classify_sql("REVOKE SELECT ON t FROM user1")
        assert result.error is not None
        assert "REVOKE" in result.error

    def test_vacuum(self):
        result = _classify_sql("VACUUM")
        assert result.error is not None
        assert "VACUUM" in result.error

    def test_analyze(self):
        result = _classify_sql("ANALYZE t")
        assert result.error is not None
        assert "ANALYZE" in result.error

    def test_truncate(self):
        result = _classify_sql("TRUNCATE TABLE t")
        assert result.error is not None
        assert "TRUNCATE" in result.error

    def test_create_table_non_temp(self):
        result = _classify_sql("CREATE TABLE t (id INT)")
        assert result.error is not None
        assert "not allowed" in result.error

    def test_create_index(self):
        result = _classify_sql("CREATE INDEX idx ON t (col)")
        assert result.error is not None
        assert "not allowed" in result.error

    def test_drop_index(self):
        result = _classify_sql("DROP INDEX idx")
        assert result.error is not None
        assert "not allowed" in result.error

    def test_drop_database(self):
        result = _classify_sql("DROP DATABASE db")
        assert result.error is not None
        assert "not allowed" in result.error

    def test_drop_view(self):
        result = _classify_sql("DROP VIEW v")
        assert result.error is not None
        assert "not allowed" in result.error

    def test_create_view(self):
        result = _classify_sql("CREATE VIEW v AS SELECT 1")
        assert result.error is not None
        assert "not allowed" in result.error


class TestClassifySqlError:
    """エラー系のテスト"""

    def test_empty_string(self):
        result = _classify_sql("")
        assert result.error is not None
        assert "empty" in result.error

    def test_whitespace_only(self):
        result = _classify_sql("   ")
        assert result.error is not None
        assert "empty" in result.error

    def test_multiple_statements(self):
        result = _classify_sql("SELECT 1; SELECT 2")
        assert result.error is not None
        assert "Multiple" in result.error


# ============================================================
# _validate_filename テスト
# ============================================================


class TestValidateFilename:
    """_validate_filename のテスト"""

    def test_valid_filename(self):
        assert _validate_filename("data.csv") is None

    def test_empty_string(self):
        result = _validate_filename("")
        assert result is not None

    def test_path_traversal(self):
        result = _validate_filename("../etc/passwd")
        assert result is not None

    def test_slash_in_filename(self):
        result = _validate_filename("dir/file.csv")
        assert result is not None

    def test_missing_csv_extension(self):
        result = _validate_filename("data.txt")
        assert result is not None


# ============================================================
# _validate_export_filename テスト
# ============================================================


class TestValidateExportFilename:
    """_validate_export_filename のテスト（タスク 33.1 で追加予定の関数）"""

    @pytest.fixture(autouse=True)
    def _skip_if_not_implemented(self):
        if _validate_export_filename is None:
            pytest.skip("_validate_export_filename is not yet implemented")

    def test_valid_parquet(self):
        """正常系: parquet 形式のファイル名"""
        result = _validate_export_filename("data.parquet", "parquet")
        assert result is None

    def test_valid_csv(self):
        """正常系: csv 形式のファイル名"""
        result = _validate_export_filename("data.csv", "csv")
        assert result is None

    def test_path_traversal(self):
        """異常系: パストラバーサル"""
        result = _validate_export_filename("../data.parquet", "parquet")
        assert result is not None

    def test_extension_mismatch_csv_for_parquet(self):
        """異常系: format=parquet なのに .csv 拡張子"""
        result = _validate_export_filename("data.csv", "parquet")
        assert result is not None

    def test_extension_mismatch_parquet_for_csv(self):
        """異常系: format=csv なのに .parquet 拡張子"""
        result = _validate_export_filename("data.parquet", "csv")
        assert result is not None

    def test_empty_string(self):
        """異常系: 空文字列"""
        result = _validate_export_filename("", "parquet")
        assert result is not None

    def test_slash_in_filename(self):
        """異常系: スラッシュを含むファイル名"""
        result = _validate_export_filename("dir/data.parquet", "parquet")
        assert result is not None

    def test_backslash_in_filename(self):
        """異常系: バックスラッシュを含むファイル名"""
        result = _validate_export_filename("dir\\data.parquet", "parquet")
        assert result is not None

    def test_null_byte(self):
        """異常系: NULLバイトを含むファイル名"""
        result = _validate_export_filename("data\0.parquet", "parquet")
        assert result is not None


# ============================================================
# SELECT 専用バリデーションテスト（export 用）
# ============================================================


class TestExportSelectOnlyValidation:
    """export は SELECT 文のみ許可する。_classify_sql を流用して判定する。"""

    def test_select_allowed(self):
        """正常系: SELECT 文は export で使用可能"""
        result = _classify_sql("SELECT * FROM t")
        assert result.is_select is True
        assert result.error is None

    def test_select_with_cte_allowed(self):
        """正常系: WITH (CTE) + SELECT も export で使用可能"""
        result = _classify_sql("WITH cte AS (SELECT 1) SELECT * FROM cte")
        assert result.is_select is True
        assert result.error is None

    def test_insert_not_allowed_for_export(self):
        """異常系: INSERT 文は is_select=False → export では SQL_NOT_ALLOWED"""
        result = _classify_sql("INSERT INTO t VALUES (1, 'a')")
        assert result.is_select is False
        # INSERT 自体は _classify_sql で error=None（execute では許可）だが、
        # export ハンドラーでは is_select=False を SQL_NOT_ALLOWED として拒否する

    def test_delete_not_allowed_for_export(self):
        """異常系: DELETE 文は _classify_sql でブロックされる"""
        result = _classify_sql("DELETE FROM t")
        assert result.error is not None
        assert "DELETE" in result.error

    def test_update_not_allowed_for_export(self):
        """異常系: UPDATE 文は is_select=False → export では SQL_NOT_ALLOWED"""
        result = _classify_sql("UPDATE t SET col = 'val'")
        assert result.is_select is False

    def test_create_temp_table_not_allowed_for_export(self):
        """異常系: CREATE TEMP TABLE は is_select=False → export では SQL_NOT_ALLOWED"""
        result = _classify_sql("CREATE TEMP TABLE t AS SELECT 1")
        assert result.is_select is False


# ============================================================
# _normalize_parquet_schema テスト
# ============================================================

pytest = __import__("pytest")
pa = pytest.importorskip("pyarrow")


class TestNormalizeParquetSchema:
    """decimal128 を float64 に正規化するスキーマ変換のテスト"""

    def test_decimal_converted_to_float64(self):
        """decimal128 フィールドが float64 に変換される"""
        schema = pa.schema(
            [
                pa.field("amount", pa.decimal128(28, 20)),
                pa.field("name", pa.string()),
            ]
        )
        result = _normalize_parquet_schema(schema)
        assert result.field("amount").type == pa.float64()
        assert result.field("name").type == pa.string()

    def test_different_decimal_precisions(self):
        """異なる精度の decimal128 がすべて float64 に変換される"""
        schema = pa.schema(
            [
                pa.field("a", pa.decimal128(27, 20)),
                pa.field("b", pa.decimal128(38, 10)),
                pa.field("c", pa.decimal128(10, 2)),
            ]
        )
        result = _normalize_parquet_schema(schema)
        for field in result:
            assert field.type == pa.float64()

    def test_non_decimal_types_unchanged(self):
        """decimal 以外の型はそのまま保持される"""
        schema = pa.schema(
            [
                pa.field("id", pa.int64()),
                pa.field("name", pa.string()),
                pa.field("flag", pa.bool_()),
                pa.field("score", pa.float64()),
            ]
        )
        result = _normalize_parquet_schema(schema)
        assert result.field("id").type == pa.int64()
        assert result.field("name").type == pa.string()
        assert result.field("flag").type == pa.bool_()
        assert result.field("score").type == pa.float64()

    def test_mixed_schema(self):
        """decimal と非 decimal が混在するスキーマの正規化"""
        schema = pa.schema(
            [
                pa.field("membership_no", pa.string()),
                pa.field("purchase_amount", pa.decimal128(28, 20)),
                pa.field("date_str", pa.string()),
                pa.field("count", pa.int64()),
            ]
        )
        result = _normalize_parquet_schema(schema)
        assert result.field("membership_no").type == pa.string()
        assert result.field("purchase_amount").type == pa.float64()
        assert result.field("date_str").type == pa.string()
        assert result.field("count").type == pa.int64()

    def test_empty_schema(self):
        """空スキーマでもエラーにならない"""
        schema = pa.schema([])
        result = _normalize_parquet_schema(schema)
        assert len(result) == 0
