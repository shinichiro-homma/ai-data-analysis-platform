"""workspace_handlers の同期 I/O オフロードテスト

タスク 23.2: 各ワークスペースハンドラーから同期 I/O を関数として抽出し、
run_in_executor 経由で呼び出すことを検証する。

テスト対象（いずれも workspace_handlers.py に追加予定）:
- _create_workspace_sync: ディレクトリ作成と metadata.json 書き込み（未実装）
- _list_workspaces_sync: ワークスペース一覧の同期取得（未実装）
- _update_metadata_sync: メタデータの部分更新（未実装）
- _read_templates_sync: テンプレートファイルの同期読み込み（未実装）
- 全ハンドラーが run_in_executor 経由で同期関数を呼び出す（未実装）

Red フェーズ: sync 関数は未実装のため失敗。ハンドラーは run_in_executor 未使用のため失敗。
"""

import importlib.util
import inspect
import json
import sys
import types as _types
from pathlib import Path

# --- モジュールのセットアップ ---
# custom_api パッケージの __init__.py を経由せず、workspace_handlers.py を単体ロードする。
# Tornado/jupyter_server 等の外部依存はモックで置き換える
# （test_kernel_executor_serialization.py:28-72 のパターンを踏襲）

_ext_dir = Path(__file__).resolve().parent.parent / "extensions"


def _ensure_mock_module(name: str, **attrs) -> _types.ModuleType:
    """sys.modules にモックモジュールを登録（未登録の場合のみ）"""
    if name not in sys.modules:
        mod = _types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod
    return sys.modules[name]


def _load_module(name: str, filename: str) -> _types.ModuleType:
    """extensions/custom_api/ 配下のモジュールをファイルからロード"""
    sys.modules.pop(name, None)
    path = _ext_dir / "custom_api" / filename
    spec = importlib.util.spec_from_file_location(name, path, submodule_search_locations=[])
    mod = importlib.util.module_from_spec(spec)
    mod.__package__ = "custom_api"
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# 1. custom_api パッケージ構造の構築
if "custom_api" not in sys.modules:
    _pkg = _types.ModuleType("custom_api")
    _pkg.__path__ = [str(_ext_dir / "custom_api")]
    _pkg.__package__ = "custom_api"
    sys.modules["custom_api"] = _pkg

# 2. 外部依存のモック
_ensure_mock_module("jupyter_server")
_ensure_mock_module("jupyter_server.base")
_ensure_mock_module(
    "jupyter_server.base.handlers",
    APIHandler=type("APIHandler", (), {}),
    JupyterHandler=type("JupyterHandler", (), {}),
)
_ensure_mock_module("tornado")
_ensure_mock_module("tornado.web", authenticated=lambda f: f)

# 3. base.py のロード（BaseCustomHandler, utc_now_iso 等の実モジュール）
base_mod = _load_module("custom_api.base", "base.py")

# 4. workspace_handlers.py のロード
ws_mod = _load_module("custom_api.workspace_handlers", "workspace_handlers.py")

WorkspacesHandler = ws_mod.WorkspacesHandler
WorkspaceHandler = ws_mod.WorkspaceHandler
WorkspaceSummarizeHandler = ws_mod.WorkspaceSummarizeHandler

# sync 関数は未実装なので getattr でフォールバック
_create_workspace_sync = getattr(ws_mod, "_create_workspace_sync", None)
_list_workspaces_sync = getattr(ws_mod, "_list_workspaces_sync", None)
_update_metadata_sync = getattr(ws_mod, "_update_metadata_sync", None)
_read_templates_sync = getattr(ws_mod, "_read_templates_sync", None)


# =============================================================================
# ヘルパー
# =============================================================================


def _write_workspace(root: Path, workspace_id: str, name: str, created_at: str) -> Path:
    """テスト用のワークスペースディレクトリと metadata.json を作成する"""
    ws_dir = root / workspace_id
    ws_dir.mkdir(parents=True, exist_ok=True)
    (ws_dir / "data").mkdir(exist_ok=True)
    (ws_dir / "output").mkdir(exist_ok=True)
    metadata = {
        "workspace_id": workspace_id,
        "name": name,
        "created_at": created_at,
        "summary": "",
        "status": "not_started",
    }
    with open(ws_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False)
    return ws_dir


# =============================================================================
# テスト
# =============================================================================


class TestCreateWorkspaceSync:
    """_create_workspace_sync のテスト（完了条件 5）"""

    def test_creates_dirs_and_metadata(self, tmp_path: Path):
        """ディレクトリ構造と metadata.json が正しく作成される"""
        assert _create_workspace_sync is not None, "_create_workspace_sync is not yet implemented"

        # Act
        _create_workspace_sync(
            str(tmp_path),
            "ws-abc12345",
            "Test Workspace",
            "test summary",
            "not_started",
            "2024-01-01T00:00:00Z",
        )

        # Assert: ディレクトリ構造
        ws_dir = tmp_path / "ws-abc12345"
        assert ws_dir.exists()
        assert (ws_dir / "data").exists()
        assert (ws_dir / "output").exists()
        assert (ws_dir / "metadata.json").exists()

        # Assert: metadata.json の内容
        with open(ws_dir / "metadata.json", encoding="utf-8") as f:
            metadata = json.load(f)
        assert metadata["workspace_id"] == "ws-abc12345"
        assert metadata["name"] == "Test Workspace"
        assert metadata["summary"] == "test summary"
        assert metadata["status"] == "not_started"
        assert metadata["created_at"] == "2024-01-01T00:00:00Z"


class TestListWorkspacesSync:
    """_list_workspaces_sync のテスト（完了条件 5）"""

    def test_returns_sorted_workspaces(self, tmp_path: Path):
        """ワークスペースが created_at 降順でソートされて返される"""
        assert _list_workspaces_sync is not None, "_list_workspaces_sync is not yet implemented"

        # Arrange: 時系列で 3 つのワークスペースを作成
        _write_workspace(tmp_path, "ws-oldest", "Oldest", "2024-01-01T00:00:00Z")
        _write_workspace(tmp_path, "ws-newest", "Newest", "2024-03-01T00:00:00Z")
        _write_workspace(tmp_path, "ws-middle", "Middle", "2024-02-01T00:00:00Z")

        # Act
        result = _list_workspaces_sync(str(tmp_path))

        # Assert: created_at 降順
        assert len(result) == 3
        assert result[0]["created_at"] == "2024-03-01T00:00:00Z"
        assert result[1]["created_at"] == "2024-02-01T00:00:00Z"
        assert result[2]["created_at"] == "2024-01-01T00:00:00Z"

    def test_empty_root_returns_empty_list(self, tmp_path: Path):
        """空のルートディレクトリでは空リストが返される"""
        assert _list_workspaces_sync is not None, "_list_workspaces_sync is not yet implemented"

        # Act
        result = _list_workspaces_sync(str(tmp_path))

        # Assert
        assert result == []


class TestUpdateMetadataSync:
    """_update_metadata_sync のテスト（完了条件 5）"""

    def test_partial_update_preserves_other_fields(self, tmp_path: Path):
        """summary のみ更新しても他のフィールド（name, status 等）が保持される"""
        assert _update_metadata_sync is not None, "_update_metadata_sync is not yet implemented"

        # Arrange
        _write_workspace(tmp_path, "ws-target", "Original Name", "2024-01-01T00:00:00Z")
        # status を事前に設定
        metadata_path = tmp_path / "ws-target" / "metadata.json"
        with open(metadata_path, encoding="utf-8") as f:
            metadata = json.load(f)
        metadata["status"] = "in_progress"
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False)

        # Act: summary のみ更新
        result = _update_metadata_sync(str(tmp_path), "ws-target", "new summary", None)

        # Assert: summary が更新され、他のフィールドは保持
        assert result is not None
        assert result["summary"] == "new summary"
        assert result["status"] == "in_progress"
        assert result["name"] == "Original Name"
        assert result["workspace_id"] == "ws-target"


class TestReadTemplatesSync:
    """_read_templates_sync のテスト（完了条件 5）"""

    def test_reads_both_templates(self, tmp_path: Path):
        """summary_template.md と verification_criteria.md の両方が読み込まれる"""
        assert _read_templates_sync is not None, "_read_templates_sync is not yet implemented"

        # Arrange
        (tmp_path / "summary_template.md").write_text("# Summary Template", encoding="utf-8")
        (tmp_path / "verification_criteria.md").write_text("# Criteria", encoding="utf-8")

        # Act
        result = _read_templates_sync(str(tmp_path))

        # Assert
        assert result["template"] == "# Summary Template"
        assert result["verification_criteria"] == "# Criteria"


class TestWorkspaceHandlersUseExecutor:
    """全ハンドラーが run_in_executor を使用していることの検証（完了条件 2）"""

    def test_handlers_call_run_in_executor(self):
        """post/get/put/post の各ハンドラーが run_in_executor 経由で同期関数を呼び出す"""
        handler_methods = [
            (WorkspacesHandler, "post"),
            (WorkspacesHandler, "get"),
            (WorkspaceHandler, "put"),
            (WorkspaceSummarizeHandler, "post"),
        ]
        for cls, method_name in handler_methods:
            method = getattr(cls, method_name)
            source = inspect.getsource(method)
            assert "run_in_executor" in source, f"{cls.__name__}.{method_name} should use run_in_executor"
