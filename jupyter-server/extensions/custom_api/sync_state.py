"""ノートブックごとの単調増加 seq ストア（タスク 21.3）

save ラップ成功時に notebook_changed イベントを配信するための
seq 管理モジュール。
"""

from .ai_events import broadcast_event

# パスごとの seq を管理する辞書
_seq_store: dict[str, int] = {}


def next_seq(path: str) -> int:
    """seq を +1 して返す。未知パスは 1 から始まる。"""
    current = _seq_store.get(path, 0)
    new_seq = current + 1
    _seq_store[path] = new_seq
    return new_seq


def get_seq(path: str) -> int:
    """最新 seq を返す。未知パスは 0。"""
    return _seq_store.get(path, 0)


def get_all() -> dict[str, int]:
    """全パスの seq dict を返す。"""
    return dict(_seq_store)


def get_sync_state_payload() -> dict:
    """同期状態照会ペイロードを返す。

    Returns:
        {"notebooks": {path: seq, ...}, "locks": [{notebook_path, expires_at}, ...]}
        token はレスポンスに含めない。
    """
    from .notebook_locks import get_locks

    notebooks = get_all()
    active_locks = get_locks()
    locks = [{"notebook_path": path, "expires_at": entry["expires_at"]} for path, entry in active_locks.items()]
    return {"notebooks": notebooks, "locks": locks}


def clear_all() -> None:
    """テスト用リセット。"""
    _seq_store.clear()


def notify_notebook_changed(path: str) -> None:
    """seq を進め、notebook_changed イベントを配信する。"""
    seq = next_seq(path)
    broadcast_event(
        {
            "type": "notebook_changed",
            "notebook_path": path,
            "seq": seq,
        }
    )
