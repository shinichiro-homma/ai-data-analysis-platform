"""ノートブックロックストア（タスク 21.2）

path → {token, expires_at} のインメモリストア。書き込み系 API のロックを
サーバー側の状態として強制するための最小ロジック（不変条件 I2）。

設計（api-contracts / タスク計画 21.2）:
- acquire / release / renew / get_locks / sweep_expired
- ContextVar lock_token_ctx（正当な書き込みのトークン識別）
- TTL 失効（デフォルト 60 秒、上限 600 秒）

操作は Tornado のシングルイベントループ上で同期実行される前提（await を挟まない）。
このため辞書操作の間にコンテキストスイッチが起きず、race condition は発生しない。
"""

import contextvars
import secrets
import time
from typing import TypedDict

# TTL のデフォルトと上限（秒）
DEFAULT_TTL = 60
MAX_TTL = 600

# 正当な書き込みを識別するためのロックトークン ContextVar
lock_token_ctx: contextvars.ContextVar[str | None] = contextvars.ContextVar("lock_token", default=None)


class LockEntry(TypedDict):
    """ロックストアの1エントリ（所有者トークンと失効時刻）。"""

    token: str
    expires_at: float


# path → {"token": str, "expires_at": float} のインメモリストア
_locks: dict[str, LockEntry] = {}


def now() -> float:
    """現在時刻（epoch 秒）。テストから注入可能にするため関数化する。"""
    return time.time()


def _clamp_ttl(ttl: int) -> int:
    """TTL を有効範囲（0 以上 MAX_TTL 以下）に丸める。"""
    if ttl < 0:
        return 0
    if ttl > MAX_TTL:
        return MAX_TTL
    return ttl


def acquire(path: str, ttl: int = DEFAULT_TTL) -> LockEntry | None:
    """ロックを取得する。成功時 {token, expires_at}、競合時 None。

    既存のロックが失効している場合は取得を許可する（先勝ちだが、失効エントリは上書き可）。
    """
    current = now()
    existing = _locks.get(path)
    if existing is not None and existing["expires_at"] > current:
        # 有効なロックが存在する（競合）
        return None

    token = secrets.token_urlsafe(24)
    expires_at = current + _clamp_ttl(ttl)
    _locks[path] = {"token": token, "expires_at": expires_at}
    return {"token": token, "expires_at": expires_at}


def release(path: str, token: str) -> bool:
    """ロックを解放する。所有者トークン一致時 True、それ以外 False。"""
    existing = _locks.get(path)
    if existing is None:
        return False
    if existing["token"] != token:
        return False
    del _locks[path]
    return True


def renew(path: str, token: str, ttl: int = DEFAULT_TTL) -> LockEntry | None:
    """ロックの TTL を延長する。成功時 {token, expires_at}、失敗時 None。"""
    existing = _locks.get(path)
    if existing is None:
        return None
    if existing["token"] != token:
        return None
    expires_at = now() + _clamp_ttl(ttl)
    existing["expires_at"] = expires_at
    return {"token": token, "expires_at": expires_at}


def is_locked(path: str, current: float | None = None) -> bool:
    """path が有効なロック中かどうかを返す（失効したロックは False）。"""
    existing = _locks.get(path)
    if existing is None:
        return False
    ref = now() if current is None else current
    return existing["expires_at"] > ref


def get_lock_token(path: str) -> str | None:
    """path の有効なロックトークンを返す（未ロック・失効時は None）。"""
    existing = _locks.get(path)
    if existing is None:
        return None
    if existing["expires_at"] <= now():
        return None
    return existing["token"]


def get_locks() -> dict:
    """現在有効なロックの dict を返す。"""
    current = now()
    return {path: entry for path, entry in _locks.items() if entry["expires_at"] > current}


def sweep_expired(now: float) -> list:
    """失効したエントリを除去し、その path のリストを返す。

    Args:
        now: 判定基準時刻（epoch 秒）。テスト・スイーパーから注入される。
    """
    expired = [path for path, entry in _locks.items() if entry["expires_at"] <= now]
    for path in expired:
        del _locks[path]
    return expired


def clear_all() -> None:
    """ストアを全消去する（テスト用）。"""
    _locks.clear()
