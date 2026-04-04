import os
from pathlib import Path

_ALLOWED_DATA_ENVS = {"sample", "production"}

DATA_ENV: str = os.environ.get("DATA_ENV", "sample")
if DATA_ENV not in _ALLOWED_DATA_ENVS:
    raise ValueError(f"Invalid DATA_ENV='{DATA_ENV}'. Must be one of: {_ALLOWED_DATA_ENVS}")


def _resolve_data_dir() -> Path:
    """Resolve DATA_DIR from env vars. DATA_DIR takes precedence over DATA_ENV."""
    raw = os.environ.get("DATA_DIR")
    if raw:
        return Path(raw).resolve()
    return Path(f"./data/{DATA_ENV}").resolve()


def _parse_port() -> int:
    raw = os.environ.get("PORT", "3002")
    try:
        port = int(raw)
    except ValueError:
        raise ValueError(f"Invalid PORT='{raw}'. Must be an integer.") from None
    if not (1 <= port <= 65535):
        raise ValueError(f"Invalid PORT={port}. Must be between 1 and 65535.")
    return port


DATA_DIR: Path = _resolve_data_dir()
PORT: int = _parse_port()
CORS_ORIGINS: list[str] = [
    origin.strip() for origin in os.environ.get("CORS_ORIGINS", "http://localhost:8888").split(",") if origin.strip()
]
