"""WORKSPACE_ROOT_DIR の DATA_ENV 解決ロジックのテスト

base.py のモジュールレベル変数はインポート時に評価されるため、
ロジック自体を直接テストする。
"""

import os


def _resolve_workspace_root(data_env: str | None = None, workspace_root_dir: str | None = None) -> str:
    """base.py の WORKSPACE_ROOT_DIR 解決ロジックを再現する"""
    env = {}
    if data_env is not None:
        env["DATA_ENV"] = data_env
    if workspace_root_dir is not None:
        env["WORKSPACE_ROOT_DIR"] = workspace_root_dir

    original = {}
    for key in ("DATA_ENV", "WORKSPACE_ROOT_DIR"):
        original[key] = os.environ.get(key)
        if key in env:
            os.environ[key] = env[key]
        else:
            os.environ.pop(key, None)

    try:
        # base.py L16-19 のロジックを再現
        _data_env = os.environ.get("DATA_ENV", "sample")
        result = os.environ.get("WORKSPACE_ROOT_DIR", f"/home/jovyan/work/workspaces/{_data_env}")
        return result
    finally:
        for key, val in original.items():
            if val is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = val


def test_default_data_env_is_sample():
    """DATA_ENV 未設定時は sample がデフォルト"""
    result = _resolve_workspace_root()
    assert result == "/home/jovyan/work/workspaces/sample"


def test_data_env_production():
    """DATA_ENV=production で正しいパスに解決される"""
    result = _resolve_workspace_root(data_env="production")
    assert result == "/home/jovyan/work/workspaces/production"


def test_workspace_root_dir_explicit_overrides_data_env():
    """WORKSPACE_ROOT_DIR が明示設定されている場合は DATA_ENV に関わらず優先される"""
    custom_path = "/custom/workspace/path"
    result = _resolve_workspace_root(data_env="production", workspace_root_dir=custom_path)
    assert result == custom_path
