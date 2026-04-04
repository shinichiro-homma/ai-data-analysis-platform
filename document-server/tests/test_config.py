"""DATA_ENV / DATA_DIR path resolution tests."""

from __future__ import annotations

import importlib
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    _COMMON_LOGIC_CODE_FILES,
    _COMMON_LOGIC_META_YAMLS,
    _COMMON_TERM_YAMLS,
    SAMPLE_INDEX_YAML,
    SAMPLE_LOGIC_INDEX_YAML,
    SAMPLE_TABLE_YAML,
    SAMPLE_TERM_INDEX_YAML,
    _create_data_dir,
)


def _reload_config(env: dict[str, str]) -> object:
    """Reload src.config with the given environment variables."""
    with patch.dict("os.environ", env, clear=False):
        import src.config

        importlib.reload(src.config)
        return src.config


class TestDataEnvResolution:
    """DATA_ENV -> DATA_DIR path resolution."""

    def test_data_env_default(self) -> None:
        """DATA_ENV unset -> defaults to 'sample', DATA_DIR = ./data/sample."""
        env = {k: v for k, v in {}.items()}
        # Remove DATA_DIR and DATA_ENV if present
        with patch.dict("os.environ", env, clear=False):
            import os

            os.environ.pop("DATA_DIR", None)
            os.environ.pop("DATA_ENV", None)
            import src.config

            cfg = importlib.reload(src.config)
            assert cfg.DATA_ENV == "sample"
            assert Path("./data/sample").resolve() == cfg.DATA_DIR

    def test_data_env_production(self) -> None:
        """DATA_ENV=production -> DATA_DIR = ./data/production."""
        with patch.dict("os.environ", {"DATA_ENV": "production"}, clear=False):
            import os

            os.environ.pop("DATA_DIR", None)
            import src.config

            cfg = importlib.reload(src.config)
            assert cfg.DATA_ENV == "production"
            assert Path("./data/production").resolve() == cfg.DATA_DIR

    def test_data_dir_override(self, tmp_path: Path) -> None:
        """DATA_DIR explicit -> DATA_ENV is ignored."""
        explicit_dir = str(tmp_path / "custom")
        with patch.dict(
            "os.environ",
            {"DATA_DIR": explicit_dir, "DATA_ENV": "production"},
            clear=False,
        ):
            import src.config

            cfg = importlib.reload(src.config)
            assert Path(explicit_dir).resolve() == cfg.DATA_DIR


class TestStartupValidation:
    """Startup validation of DATA_DIR existence."""

    def test_missing_data_env_dir(self, tmp_path: Path) -> None:
        """Non-existent DATA_DIR raises RuntimeError on startup."""
        missing_dir = str(tmp_path / "nonexistent")
        with patch("src.main.DATA_DIR", Path(missing_dir)), patch("src.main.DATA_ENV", "production"):
            from src.main import app

            with pytest.raises(RuntimeError, match="Data directory not found"), TestClient(app):
                pass

    def test_load_from_sample_subdir(self, tmp_path: Path) -> None:
        """data/sample/ structure loads catalog/glossary/logic correctly."""
        sample_dir = _create_data_dir(
            tmp_path,
            index_yaml=SAMPLE_INDEX_YAML,
            table_yamls={"test_table.yaml": SAMPLE_TABLE_YAML},
            term_index_yaml=SAMPLE_TERM_INDEX_YAML,
            term_yamls=_COMMON_TERM_YAMLS,
            logic_index_yaml=SAMPLE_LOGIC_INDEX_YAML,
            logic_meta_yamls=_COMMON_LOGIC_META_YAMLS,
            logic_code_files=_COMMON_LOGIC_CODE_FILES,
        )
        with patch("src.main.DATA_DIR", sample_dir), patch("src.main.DATA_ENV", "sample"):
            from src.main import app

            with TestClient(app) as client:
                resp = client.get("/health")
                assert resp.status_code == 200
                data = resp.json()
                assert data["catalog"]["tables"] == 1
                assert data["catalog"]["terms"] == 3
                assert data["catalog"]["logic"] == 2
