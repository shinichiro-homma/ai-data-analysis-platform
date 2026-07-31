"""アプリケーション例外の定義。

exception_handler で捕捉し、統一エラーレスポンスに変換する。
"""

from __future__ import annotations


class AppError(Exception):
    """アプリケーションエラーの基底クラス。"""

    def __init__(
        self,
        status_code: int = 500,
        code: str = "INTERNAL_ERROR",
        message: str = "An internal error occurred.",
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


class CatalogLoadError(AppError):
    """カタログ読み込みエラー。"""

    def __init__(self, message: str = "Failed to reload catalog. Check server logs for details.") -> None:
        super().__init__(status_code=400, code="CATALOG_LOAD_ERROR", message=message)


class ResourceNotFoundError(AppError):
    """リソースが見つからないエラー。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(status_code=404, code=code, message=message)
