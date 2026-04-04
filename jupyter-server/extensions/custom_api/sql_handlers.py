"""
SQL実行 REST API ハンドラー

SQL を実行する。SELECT 系は結果 CSV をワークスペースの data/ に保存し、
非 SELECT 系は affected_rows を返却する。
ブラックリスト方式で危険な操作を拒否する。
"""

from __future__ import annotations

import asyncio
import csv
import logging
import os
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pyarrow as pa

import pandas as pd
import sqlalchemy
import sqlparse
from tornado import web

from .base import (
    BaseCustomHandler,
    resolve_workspace_dir,
    validate_timeout,
    validate_workspace_id,
    workspace_contents_path,
)

log = logging.getLogger(__name__)

# 明示的ブラックリスト: これらの先頭キーワードは無条件で拒否
BLOCKED_COMMANDS = frozenset({"DELETE", "ALTER", "GRANT", "REVOKE", "VACUUM", "ANALYZE", "TRUNCATE", "COPY"})


@dataclass
class SqlClassification:
    is_select: bool  # True: SELECT系, False: 非SELECT系
    error: str | None  # 拒否の場合のエラーメッセージ（許可時は None）


def _get_significant_tokens(stmt):
    """ステートメントからコメント・空白以外のトークンを順に返す。"""
    for token in stmt.tokens:
        if token.ttype in (
            sqlparse.tokens.Whitespace,
            sqlparse.tokens.Newline,
            sqlparse.tokens.Comment.Single,
            sqlparse.tokens.Comment.Multiline,
        ):
            continue
        yield token


def _collect_keywords_after_command(stmt, max_count: int) -> list[str]:
    """コマンドトークン以降のキーワードを最大 max_count 個収集する。"""
    tokens = list(_get_significant_tokens(stmt))
    keywords = []
    for t in tokens[1:]:
        word = t.normalized.upper() if t.ttype is not None else str(t).strip().upper()
        if word:
            keywords.append(word)
        if len(keywords) >= max_count:
            break
    return keywords


def _classify_create(stmt) -> SqlClassification:
    """
    CREATE 文の後続トークンを解析し、安全な形式のみ許可する。

    許可:
      - CREATE TEMP TABLE ... / CREATE TEMPORARY TABLE ...
      - CREATE OR REPLACE FUNCTION ...
    拒否:
      - CREATE TABLE（非TEMP）, CREATE INDEX, CREATE VIEW 等
    """
    keywords = _collect_keywords_after_command(stmt, 4)

    # CREATE TEMP TABLE / CREATE TEMPORARY TABLE
    if len(keywords) >= 1 and keywords[0] in ("TEMP", "TEMPORARY"):
        return SqlClassification(is_select=False, error=None)

    # CREATE OR REPLACE FUNCTION
    if len(keywords) >= 3 and keywords[:3] == ["OR", "REPLACE", "FUNCTION"]:
        return SqlClassification(is_select=False, error=None)

    # その他の CREATE は拒否
    target = keywords[0] if keywords else "unknown"
    return SqlClassification(
        is_select=False,
        error=f"CREATE {target} statements are not allowed. Use CREATE TEMP TABLE or CREATE OR REPLACE FUNCTION instead.",
    )


def _classify_drop(stmt) -> SqlClassification:
    """
    DROP 文の後続トークンを解析し、安全な形式のみ許可する。

    許可:
      - DROP TABLE ...
      - DROP FUNCTION ...
    拒否:
      - DROP INDEX, DROP DATABASE, DROP VIEW 等
    """
    keywords = _collect_keywords_after_command(stmt, 1)

    if len(keywords) >= 1 and keywords[0] in ("TABLE", "FUNCTION"):
        return SqlClassification(is_select=False, error=None)

    target = keywords[0] if keywords else "unknown"
    return SqlClassification(
        is_select=False,
        error=f"DROP {target} statements are not allowed. Only DROP TABLE and DROP FUNCTION are permitted.",
    )


def _classify_sql(sql: str) -> SqlClassification:
    """
    SQL を分類し、許可/拒否を判定する（ブラックリスト方式）。

    - SELECT / WITH → is_select=True（結果セットあり、CSV保存対象）
    - ブラックリスト（DELETE, ALTER, GRANT, REVOKE, VACUUM, ANALYZE, TRUNCATE, COPY）→ error
    - CREATE → 後続トークン判定（TEMP TABLE, OR REPLACE FUNCTION のみ許可）
    - DROP → 後続トークン判定（TABLE, FUNCTION のみ許可）
    - その他全て → is_select=False（結果セットなし、affected_rows返却）
    """
    # 正規化: 先頭・末尾の空白除去、セミコロン除去
    normalized = sql.strip().rstrip(";").strip()
    if not normalized:
        return SqlClassification(is_select=False, error="SQL query is empty")

    # sqlparse でパース
    statements = sqlparse.parse(normalized)

    # 複文チェック
    if len(statements) != 1:
        return SqlClassification(is_select=False, error="Multiple SQL statements are not allowed")

    stmt = statements[0]

    # 先頭トークンを確認（コメント・空白をスキップ）
    first_keyword = None
    for token in stmt.tokens:
        if token.ttype in (
            sqlparse.tokens.Whitespace,
            sqlparse.tokens.Newline,
            sqlparse.tokens.Comment.Single,
            sqlparse.tokens.Comment.Multiline,
        ):
            continue
        if token.ttype is sqlparse.tokens.Keyword.DML:
            first_keyword = token.normalized.upper()
            break
        if token.ttype is sqlparse.tokens.Keyword.CTE:
            first_keyword = "WITH"
            break
        if token.ttype is sqlparse.tokens.Keyword.DDL:
            first_keyword = token.normalized.upper()
            break
        if token.ttype is sqlparse.tokens.Keyword:
            first_keyword = token.normalized.upper()
            break
        # 先頭がキーワードでない場合
        first_keyword = str(token).strip().split()[0].upper() if str(token).strip() else None
        break

    # SELECT 系
    if first_keyword in ("SELECT", "WITH"):
        return SqlClassification(is_select=True, error=None)

    # 明示的ブラックリスト
    if first_keyword in BLOCKED_COMMANDS:
        return SqlClassification(is_select=False, error=f"{first_keyword} statements are not allowed.")

    # CREATE の後続判定
    if first_keyword == "CREATE":
        return _classify_create(stmt)

    # DROP の後続判定
    if first_keyword == "DROP":
        return _classify_drop(stmt)

    # ブラックリスト外は全て許可（INSERT, UPDATE, BEGIN, COMMIT, ROLLBACK 等）
    return SqlClassification(is_select=False, error=None)


def _validate_filename(filename: str) -> str | None:
    """
    ファイル名のバリデーション（.csv 固定）。

    Returns:
        None: 正常
        str: エラーメッセージ
    """
    return _validate_filename_with_extensions(filename, (".csv",))


def _validate_export_filename(filename: str, export_format: str) -> str | None:
    """
    エクスポート用ファイル名のバリデーション。

    Args:
        filename: ファイル名
        export_format: エクスポート形式（"parquet" または "csv"）

    Returns:
        None: 正常
        str: エラーメッセージ
    """
    if export_format == "parquet":
        allowed_extensions = (".parquet",)
        ext_error_suffix = "for parquet format"
    else:
        allowed_extensions = (".csv",)
        ext_error_suffix = "for csv format"

    error = _validate_filename_with_extensions(filename, allowed_extensions, ext_error_suffix)
    return error


def _validate_filename_with_extensions(
    filename: str,
    allowed_extensions: tuple[str, ...],
    ext_error_suffix: str = "",
) -> str | None:
    """
    ファイル名の共通バリデーション。

    Args:
        filename: ファイル名
        allowed_extensions: 許可する拡張子のタプル（例: (".csv",) や (".parquet", ".csv")）
        ext_error_suffix: 拡張子エラーメッセージに付加するサフィックス

    Returns:
        None: 正常
        str: エラーメッセージ
    """
    if not filename:
        return "filename is required"

    # NULLバイト防止
    if "\0" in filename:
        return "filename contains invalid characters"

    # パストラバーサル防止
    if ".." in filename or "/" in filename or "\\" in filename:
        return "filename contains invalid characters"

    # 絶対パス防止
    if os.path.isabs(filename):
        return "filename must not be an absolute path"

    # ファイル名長さチェック
    if len(filename) > 255:
        return "filename exceeds maximum length (255 characters)"

    # 拡張子チェック
    if not any(filename.endswith(ext) for ext in allowed_extensions):
        ext_list = " or ".join(allowed_extensions)
        suffix = f" {ext_error_suffix}" if ext_error_suffix else ""
        return f"filename must end with {ext_list}{suffix}"

    return None


def _handle_sql_error(handler, e, timeout: int, timeout_error_code: str, generic_error_code: str):
    """
    SQL 実行エラーの共通ハンドリング。

    Args:
        handler: BaseCustomHandler インスタンス
        e: 発生した例外
        timeout: タイムアウト秒数
        timeout_error_code: タイムアウト時に使用するエラーコード
        generic_error_code: その他エラー時に使用するエラーコード
    """
    if isinstance(e, asyncio.TimeoutError):
        handler.write_error_response(
            timeout_error_code,
            f"Query execution timed out after {timeout} seconds",
            408,
        )
    elif isinstance(e, sqlalchemy.exc.OperationalError):
        error_str = str(e.orig) if e.orig else str(e)
        if "canceling statement due to statement timeout" in error_str:
            handler.write_error_response(
                timeout_error_code,
                f"Query execution timed out after {timeout} seconds",
                408,
            )
        else:
            log.error("Database connection error: %s", error_str)
            handler.write_error_response(
                "DATABASE_CONNECTION_ERROR",
                "Could not connect to database. Check DATABASE_URL configuration.",
                500,
            )
    elif isinstance(e, sqlalchemy.exc.ProgrammingError):
        error_str = str(e.orig) if e.orig else str(e)
        log.error("SQL execution error: %s", error_str)
        handler.write_error_response(
            "SQL_EXECUTION_ERROR",
            "SQL execution failed. Check your query syntax.",
            400,
        )
    else:
        log.error("Unexpected SQL execution error: %s", e, exc_info=True)
        handler.write_error_response(
            generic_error_code,
            "An unexpected error occurred during SQL execution",
            500,
        )


def _normalize_parquet_schema(schema: pa.Schema) -> pa.Schema:
    """decimal128 を float64 に正規化したスキーマを返す。

    PostgreSQL の NUMERIC 型は精度が可変で、チャンクごとに pandas/PyArrow が推論する
    decimal128 の precision が異なりうる。float64 に統一することでスキーマ不一致を防ぐ。
    """
    import pyarrow as pa

    fields = []
    for field in schema:
        if pa.types.is_decimal(field.type):
            fields.append(pa.field(field.name, pa.float64()))
        else:
            fields.append(field)
    return pa.schema(fields)


def _write_parquet_chunked(conn, sql: str, output_path, chunk_size: int = 10_000) -> int:
    """
    SELECT クエリの結果を Parquet 形式でチャンク書き出しする。

    Args:
        conn: SQLAlchemy 接続オブジェクト
        sql: SELECT SQL
        output_path: 出力ファイルパス
        chunk_size: チャンクサイズ（行数）

    Returns:
        合計行数

    Raises:
        Exception: 書き出しエラー
    """
    import pyarrow as pa
    import pyarrow.parquet as pq

    result = conn.execute(sqlalchemy.text(sql))
    columns = list(result.keys())
    total_rows = 0
    writer = None
    normalized_schema = None

    try:
        while True:
            rows = result.fetchmany(chunk_size)
            if not rows:
                if writer is None:
                    # 0行でもファイルを作成する（空テーブル）
                    schema = pa.schema([pa.field(col, pa.string()) for col in columns])
                    table = pa.table({col: [] for col in columns}, schema=schema)
                    pq.write_table(table, str(output_path))
                break

            df = pd.DataFrame(rows, columns=columns)
            table = pa.Table.from_pandas(df, preserve_index=False)

            if writer is None:
                normalized_schema = _normalize_parquet_schema(table.schema)
                writer = pq.ParquetWriter(str(output_path), normalized_schema)

            table = table.cast(normalized_schema)
            writer.write_table(table)
            total_rows += len(rows)
    finally:
        if writer is not None:
            writer.close()

    return total_rows


def _write_csv_chunked(conn, sql: str, output_path, chunk_size: int = 10_000) -> int:
    """
    SELECT クエリの結果を CSV 形式（UTF-8 BOM付き）でチャンク書き出しする。

    Args:
        conn: SQLAlchemy 接続オブジェクト
        sql: SELECT SQL
        output_path: 出力ファイルパス
        chunk_size: チャンクサイズ（行数）

    Returns:
        合計行数

    Raises:
        Exception: 書き出しエラー
    """
    result = conn.execute(sqlalchemy.text(sql))
    columns = list(result.keys())
    total_rows = 0

    with open(str(output_path), "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(columns)

        while True:
            rows = result.fetchmany(chunk_size)
            if not rows:
                break
            for row in rows:
                writer.writerow(row)
            total_rows += len(rows)

    return total_rows


def _export_sql_sync(database_url: str, sql: str, timeout: int, output_path, export_format: str) -> dict:
    """
    SELECT SQL をチャンク処理でファイルにエクスポートする（スレッドプールで実行される想定）。

    Returns:
        dict: {"row_count": int}

    Raises:
        sqlalchemy.exc.OperationalError: DB接続エラー、タイムアウトなど
        sqlalchemy.exc.ProgrammingError: SQL構文エラーなど
    """
    engine = _create_sql_engine(database_url)
    try:
        with engine.connect() as conn:
            # 読み取り専用トランザクション
            conn.execute(sqlalchemy.text("SET default_transaction_read_only = ON"))

            # PostgreSQL statement_timeout を設定（ミリ秒単位）
            timeout_ms = timeout * 1000
            conn.execute(
                sqlalchemy.text("SET statement_timeout = :timeout_ms"),
                {"timeout_ms": timeout_ms},
            )

            if export_format == "parquet":
                row_count = _write_parquet_chunked(conn, sql, output_path)
            else:
                row_count = _write_csv_chunked(conn, sql, output_path)

            return {"row_count": row_count}
    finally:
        engine.dispose()


def _create_sql_engine(database_url: str):
    """SQLAlchemy エンジンを作成する。"""
    return sqlalchemy.create_engine(
        database_url,
        connect_args={"connect_timeout": 5},
        pool_size=1,
        max_overflow=0,
    )


def _execute_sql_sync(database_url: str, sql: str, timeout: int, max_rows: int) -> dict:
    """
    SQL を同期的に実行する（スレッドプールで実行される想定）。

    Returns:
        dict: {"df": DataFrame, "truncated": bool}

    Raises:
        sqlalchemy.exc.OperationalError: DB接続エラー、タイムアウトなど
        sqlalchemy.exc.ProgrammingError: SQL構文エラー、テーブルが存在しないなど
    """
    engine = _create_sql_engine(database_url)
    try:
        with engine.connect() as conn:
            # 読み取り専用トランザクション（SQLインジェクションの多層防御）
            conn.execute(sqlalchemy.text("SET default_transaction_read_only = ON"))

            # PostgreSQL statement_timeout を設定（ミリ秒単位）
            timeout_ms = timeout * 1000
            conn.execute(
                sqlalchemy.text("SET statement_timeout = :timeout_ms"),
                {"timeout_ms": timeout_ms},
            )

            result = conn.execute(sqlalchemy.text(sql))
            columns = list(result.keys())

            # max_rows + 1 行フェッチして、切り捨てが発生するか確認
            rows = result.fetchmany(max_rows + 1)
            truncated = len(rows) > max_rows
            if truncated:
                rows = rows[:max_rows]

            df = pd.DataFrame(rows, columns=columns)
            return {"df": df, "truncated": truncated}
    finally:
        engine.dispose()


def _execute_non_select_sync(database_url: str, sql: str, timeout: int) -> dict:
    """
    非 SELECT SQL を同期的に実行する。

    Returns:
        dict: {"affected_rows": int}

    Raises:
        sqlalchemy.exc.OperationalError: DB接続エラー、タイムアウトなど
        sqlalchemy.exc.ProgrammingError: SQL構文エラーなど
    """
    engine = _create_sql_engine(database_url)
    try:
        with engine.connect() as conn:
            # ※ read_only は設定しない（書き込み操作を許可）
            timeout_ms = timeout * 1000
            conn.execute(
                sqlalchemy.text("SET statement_timeout = :timeout_ms"),
                {"timeout_ms": timeout_ms},
            )
            result = conn.execute(sqlalchemy.text(sql))
            conn.commit()
            affected_rows = result.rowcount if result.rowcount >= 0 else 0
            return {"affected_rows": affected_rows}
    finally:
        engine.dispose()


class SqlExecuteHandler(BaseCustomHandler):
    """POST /api/sql/execute"""

    @web.authenticated
    async def post(self):
        body = self.get_json_body()

        # --- 1. リクエストパース ---
        sql = body.get("sql")
        workspace_id = body.get("workspace_id")
        filename = body.get("filename")
        timeout = body.get("timeout", 30)
        max_rows = body.get("max_rows", 100000)

        # sql 必須
        if not sql or not isinstance(sql, str):
            self.write_error_response("VALIDATION_ERROR", "sql is required", 400)
            return

        # --- 2. SQL 分類 ---
        classification = _classify_sql(sql)
        if classification.error:
            self.write_error_response("SQL_NOT_ALLOWED", classification.error, 400)
            return

        # --- 3. DATABASE_URL 確認 ---
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            self.write_error_response(
                "DATABASE_NOT_CONFIGURED",
                "DATABASE_URL is not configured",
                400,
            )
            return

        # --- 4. timeout バリデーション（共通） ---
        timeout, timeout_error = validate_timeout(timeout)
        if timeout_error:
            self.write_error_response("VALIDATION_ERROR", timeout_error, 400)
            return

        if classification.is_select:
            await self._handle_select(body, sql, workspace_id, filename, timeout, max_rows, database_url)
        else:
            await self._handle_non_select(sql, timeout, database_url)

    async def _handle_select(self, body, sql, workspace_id, filename, timeout, max_rows, database_url):
        """SELECT 系 SQL の処理"""
        # workspace_id バリデーション
        ws_error = validate_workspace_id(workspace_id)
        if ws_error:
            self.write_error_response("VALIDATION_ERROR", ws_error, 400)
            return

        if not filename or not isinstance(filename, str):
            self.write_error_response("VALIDATION_ERROR", "filename is required", 400)
            return

        # filename バリデーション
        filename_error = _validate_filename(filename)
        if filename_error:
            self.write_error_response("VALIDATION_ERROR", filename_error, 400)
            return

        # max_rows バリデーション
        if not isinstance(max_rows, (int, float)):
            self.write_error_response("VALIDATION_ERROR", "max_rows must be a number", 400)
            return
        if max_rows <= 0:
            self.write_error_response("VALIDATION_ERROR", "max_rows must be positive", 400)
            return
        if max_rows > 1000000:
            self.write_error_response("VALIDATION_ERROR", "max_rows exceeds maximum (1000000)", 400)
            return
        max_rows = int(max_rows)

        # ワークスペース存在確認
        try:
            workspace_dir = resolve_workspace_dir(workspace_id)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", "Invalid workspace_id", 400)
            return

        if not workspace_dir.exists() or not workspace_dir.is_dir():
            self.write_error_response(
                "WORKSPACE_NOT_FOUND",
                f"Workspace not found: {workspace_id}",
                404,
            )
            return

        data_dir = workspace_dir / "data"
        if not data_dir.exists():
            self.write_error_response(
                "WORKSPACE_NOT_FOUND",
                f"Workspace data directory not found: {workspace_id}",
                404,
            )
            return

        # SQL 実行
        start_time = time.time()
        try:
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _execute_sql_sync, database_url, sql, timeout, max_rows),
                timeout=timeout + 5,
            )
        except Exception as e:
            _handle_sql_error(self, e, timeout, "SQL_TIMEOUT", "SQL_EXECUTION_ERROR")
            return

        # CSV 保存
        df = result["df"]
        truncated = result["truncated"]
        csv_path = data_dir / filename

        try:
            df.to_csv(csv_path, index=False, encoding="utf-8-sig")
            file_size_bytes = csv_path.stat().st_size
        except Exception as e:
            log.error("Failed to save CSV to %s: %s", csv_path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to save CSV file", 500)
            return

        execution_time_ms = int((time.time() - start_time) * 1000)

        # レスポンス
        response = {
            "success": True,
            "file_path": f"{workspace_contents_path(workspace_id)}/data/{filename}",
            "row_count": len(df),
            "columns": list(df.columns),
            "file_size_bytes": file_size_bytes,
            "execution_time_ms": execution_time_ms,
        }
        if truncated:
            response["truncated"] = True

        self.write_success(response)

    async def _handle_non_select(self, sql, timeout, database_url):
        """非 SELECT 系 SQL の処理"""
        start_time = time.time()
        try:
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _execute_non_select_sync, database_url, sql, timeout),
                timeout=timeout + 5,
            )
        except Exception as e:
            _handle_sql_error(self, e, timeout, "SQL_TIMEOUT", "SQL_EXECUTION_ERROR")
            return

        execution_time_ms = int((time.time() - start_time) * 1000)

        self.write_success(
            {
                "success": True,
                "affected_rows": result["affected_rows"],
                "execution_time_ms": execution_time_ms,
            }
        )


class SqlExportHandler(BaseCustomHandler):
    """POST /api/sql/export"""

    @web.authenticated
    async def post(self):
        body = self.get_json_body()

        # --- 1. リクエストパース ---
        sql = body.get("sql")
        workspace_id = body.get("workspace_id")
        file_path = body.get("file_path")
        export_format = body.get("format", "parquet")
        timeout = body.get("timeout", 300)

        # sql 必須
        if not sql or not isinstance(sql, str):
            self.write_error_response("VALIDATION_ERROR", "sql is required", 400)
            return

        # --- 2. DATABASE_URL 確認 ---
        database_url = os.environ.get("DATABASE_URL")
        if not database_url:
            self.write_error_response(
                "DATABASE_NOT_CONFIGURED",
                "DATABASE_URL is not configured",
                500,
            )
            return

        # --- 3. workspace_id バリデーション ---
        ws_error = validate_workspace_id(workspace_id)
        if ws_error:
            self.write_error_response("VALIDATION_ERROR", ws_error, 400)
            return

        # --- 4. file_path バリデーション ---
        if not file_path or not isinstance(file_path, str):
            self.write_error_response("VALIDATION_ERROR", "file_path is required", 400)
            return

        # format バリデーション
        if export_format not in ("parquet", "csv"):
            self.write_error_response("VALIDATION_ERROR", "format must be 'parquet' or 'csv'", 400)
            return

        filename_error = _validate_export_filename(file_path, export_format)
        if filename_error:
            self.write_error_response("INVALID_FILE_PATH", filename_error, 400)
            return

        # --- 5. timeout バリデーション ---
        timeout, timeout_error = validate_timeout(timeout, max_timeout=600)
        if timeout_error:
            self.write_error_response("VALIDATION_ERROR", timeout_error, 400)
            return

        # --- 6. SQL 分類（SELECT のみ許可） ---
        classification = _classify_sql(sql)
        if classification.error:
            self.write_error_response("SQL_NOT_ALLOWED", classification.error, 400)
            return
        if not classification.is_select:
            self.write_error_response("SQL_NOT_ALLOWED", "Only SELECT statements are allowed for export", 400)
            return

        # --- 7. ワークスペース存在確認 ---
        try:
            workspace_dir = resolve_workspace_dir(workspace_id)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", "Invalid workspace_id", 400)
            return

        if not workspace_dir.exists() or not workspace_dir.is_dir():
            self.write_error_response(
                "WORKSPACE_NOT_FOUND",
                f"Workspace not found: {workspace_id}",
                404,
            )
            return

        data_dir = workspace_dir / "data"
        if not data_dir.exists():
            self.write_error_response(
                "WORKSPACE_NOT_FOUND",
                f"Workspace data directory not found: {workspace_id}",
                404,
            )
            return

        output_path = data_dir / file_path

        # --- 8. SQL エクスポート実行 ---
        start_time = time.time()
        try:
            loop = asyncio.get_running_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _export_sql_sync, database_url, sql, timeout, output_path, export_format),
                timeout=timeout + 5,
            )
        except Exception as e:
            # 中間ファイルを削除
            if output_path.exists():
                try:
                    output_path.unlink()
                except Exception as unlink_error:
                    log.warning("Failed to remove intermediate file %s: %s", output_path, unlink_error)
            _handle_sql_error(self, e, timeout, "SQL_TIMEOUT", "FILE_WRITE_ERROR")
            return

        execution_time_ms = int((time.time() - start_time) * 1000)

        try:
            file_size_bytes = output_path.stat().st_size
        except Exception as e:
            log.error("Failed to stat export file %s: %s", output_path, e, exc_info=True)
            self.write_error_response("FILE_WRITE_ERROR", "Failed to retrieve file info after export", 500)
            return

        self.write_success(
            {
                "success": True,
                "file_path": f"{workspace_contents_path(workspace_id)}/data/{file_path}",
                "row_count": result["row_count"],
                "file_size_bytes": file_size_bytes,
                "format": export_format,
                "execution_time_ms": execution_time_ms,
            }
        )
