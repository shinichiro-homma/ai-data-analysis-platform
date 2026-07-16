"""
データプレビュー REST API ハンドラー

CSV/Parquet ファイルの先頭行・カラム情報・行数を返す。
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd

from tornado import web

from .base import (
    JUPYTER_ROOT_DIR,
    BaseCustomHandler,
    validate_path,
)

log = logging.getLogger(__name__)


# =============================================================================
# ヘルパー関数
# =============================================================================


_MAX_HEAD_ROWS = 50
_DEFAULT_HEAD_ROWS = 5


def _serialize_value(val):
    """pandas/numpy 値を JSON 直列化可能な Python 型に変換する"""
    import math

    import numpy as np

    if val is None:
        return None
    if isinstance(val, float):
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    if isinstance(val, np.integer):
        return int(val)
    if isinstance(val, np.floating):
        v = float(val)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    if isinstance(val, np.bool_):
        return bool(val)
    # datetime 系は str() で ISO 8601 風に変換
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return val


def _df_to_records(df: pd.DataFrame) -> list[dict]:
    """DataFrame を JSON 直列化可能なレコードのリストに変換する"""
    rows = []
    for _, row in df.iterrows():
        rows.append({col: _serialize_value(row[col]) for col in df.columns})
    return rows


def _preview_file_sync(abs_path: str, file_format: str, head_rows: int) -> dict:
    """ファイルプレビューを同期実行する（スレッドプールで実行される想定）。

    Returns:
        dict: {"path", "format", "columns", "row_count", "head", "file_size_bytes"}
    """
    import pandas as pd

    p = Path(abs_path)
    file_size_bytes = p.stat().st_size

    if file_format == "csv":
        head_df = pd.read_csv(p, nrows=head_rows)
        # ヘッダー行を除いた全行数をカウント
        with open(p, encoding="utf-8") as f:
            row_count = sum(1 for _ in f) - 1
        columns = [{"name": col, "dtype": str(head_df[col].dtype)} for col in head_df.columns]
        head_records = _df_to_records(head_df)

    else:  # parquet
        import pyarrow.parquet as pq

        pf = pq.ParquetFile(p)
        row_count = pf.metadata.num_rows
        head_df = pf.read_row_group(0).to_pandas().head(head_rows)
        columns = [{"name": col, "dtype": str(head_df[col].dtype)} for col in head_df.columns]
        head_records = _df_to_records(head_df)

    return {
        "path": abs_path,
        "format": file_format,
        "columns": columns,
        "row_count": row_count,
        "head": head_records,
        "file_size_bytes": file_size_bytes,
    }


# =============================================================================
# データプレビュー
# =============================================================================


class ContentsPreviewHandler(BaseCustomHandler):
    """GET /api/custom/contents/{path}/preview"""

    @web.authenticated
    async def get(self, path: str):
        """CSV/Parquetファイルの先頭行・カラム情報・行数を返す"""
        try:
            path = validate_path(path)
        except ValueError as e:
            self.write_error_response("VALIDATION_ERROR", str(e), 400)
            return

        # head_rows クエリパラメータ
        head_rows_str = self.get_argument("head_rows", str(_DEFAULT_HEAD_ROWS))
        try:
            head_rows = int(head_rows_str)
        except ValueError:
            self.write_error_response("VALIDATION_ERROR", "head_rows must be an integer", 400)
            return

        if head_rows < 0:
            self.write_error_response("VALIDATION_ERROR", "head_rows must be >= 0", 400)
            return
        if head_rows > _MAX_HEAD_ROWS:
            self.write_error_response("VALIDATION_ERROR", f"head_rows must be <= {_MAX_HEAD_ROWS}", 400)
            return

        # 拡張子チェック
        if path.endswith(".csv"):
            file_format = "csv"
        elif path.endswith(".parquet"):
            file_format = "parquet"
        else:
            self.write_error_response("UNSUPPORTED_FORMAT", "Only .csv and .parquet files are supported", 400)
            return

        # 絶対パスを解決
        abs_path = Path(JUPYTER_ROOT_DIR) / path

        if not abs_path.exists():
            self.write_error_response("NOT_FOUND", f"File not found: {path}", 404)
            return

        try:
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, _preview_file_sync, str(abs_path), file_format, head_rows)
            result["path"] = "/" + path
            self.write_success(result)
        except Exception as e:
            log.error("Failed to preview file '%s': %s", path, e, exc_info=True)
            self.write_error_response("INTERNAL_ERROR", "Failed to preview file", 500)
