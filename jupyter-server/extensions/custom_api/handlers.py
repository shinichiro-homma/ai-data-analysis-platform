"""
カスタム REST API ハンドラー

api-contracts.md に定義された仕様に従った API を提供する。
各ハンドラーは専用モジュールに分割されており、このモジュールは get_handlers() で
ルーティングを組み立てる。後方互換のため、全ハンドラークラスとヘルパーを re-export する。
"""

from .ai_events import AiEventsPostHandler, AiEventsWebSocketHandler  # noqa: F401
from .cell_handlers import (
    ContentsCellExecuteBatchHandler,  # noqa: F401
    ContentsCellExecuteHandler,  # noqa: F401
    ContentsCellsClearAllOutputsHandler,  # noqa: F401
    ContentsCellsHandler,  # noqa: F401
    _load_notebook,  # noqa: F401
    _result_to_nb_outputs,  # noqa: F401
)
from .contents_handlers import (
    ContentsHandler,  # noqa: F401
    ContentsListHandler,  # noqa: F401
    _find_available_path,  # noqa: F401
    validate_path,  # noqa: F401
)
from .kernel_handlers import (
    HealthHandler,  # noqa: F401
    KernelExecuteHandler,  # noqa: F401
    KernelHandler,  # noqa: F401
    KernelInterruptHandler,  # noqa: F401
    KernelRestartHandler,  # noqa: F401
    KernelsHandler,  # noqa: F401
    KernelVariableHandler,  # noqa: F401
    KernelVariablesHandler,  # noqa: F401
    _resolve_workspace_for_kernel,  # noqa: F401
)
from .preview_handlers import (
    ContentsPreviewHandler,  # noqa: F401
    _df_to_records,  # noqa: F401
    _serialize_value,  # noqa: F401
)
from .session_handlers import CustomSessionsHandler  # noqa: F401
from .sql_handlers import SqlExecuteHandler, SqlExportHandler  # noqa: F401
from .workspace_handlers import WorkspaceHandler, WorkspacesHandler, WorkspaceSummarizeHandler  # noqa: F401


def get_handlers(base_url: str = ""):
    """ハンドラーのリストを返す"""
    return [
        (f"{base_url}/health", HealthHandler),
        (f"{base_url}/api/kernels", KernelsHandler),
        (f"{base_url}/api/kernels/([^/]+)", KernelHandler),
        (f"{base_url}/api/kernels/([^/]+)/interrupt", KernelInterruptHandler),
        (f"{base_url}/api/kernels/([^/]+)/restart", KernelRestartHandler),
        (f"{base_url}/api/kernels/([^/]+)/execute", KernelExecuteHandler),
        (f"{base_url}/api/kernels/([^/]+)/variables", KernelVariablesHandler),
        (f"{base_url}/api/kernels/([^/]+)/variables/([^/]+)", KernelVariableHandler),
        # /api/contents の代わりに /api/custom/contents を使用（JupyterLab フロントエンドとの競合を回避）
        (f"{base_url}/api/custom/contents", ContentsListHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells/([0-9]+)/execute", ContentsCellExecuteHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells/execute-batch", ContentsCellExecuteBatchHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells/clear-all-outputs", ContentsCellsClearAllOutputsHandler),
        (f"{base_url}/api/custom/contents/(.*)/cells", ContentsCellsHandler),
        (f"{base_url}/api/custom/contents/(.*)/preview", ContentsPreviewHandler),
        (f"{base_url}/api/custom/contents/(.*)", ContentsHandler),
        # AI同期イベント
        (f"{base_url}/api/ai/events", AiEventsWebSocketHandler),
        (f"{base_url}/api/ai/events/broadcast", AiEventsPostHandler),
        # ワークスペース管理
        (f"{base_url}/api/workspaces", WorkspacesHandler),
        (f"{base_url}/api/workspaces/([^/]+)/summarize", WorkspaceSummarizeHandler),
        (f"{base_url}/api/workspaces/([^/]+)", WorkspaceHandler),
        # ワークスペース内セッション作成（cwd 対応）
        (f"{base_url}/api/custom/sessions", CustomSessionsHandler),
        # SQL実行
        (f"{base_url}/api/sql/execute", SqlExecuteHandler),
        # SQLエクスポート
        (f"{base_url}/api/sql/export", SqlExportHandler),
    ]
