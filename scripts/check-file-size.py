#!/usr/bin/env python3
"""ファイルサイズ予算のラチェット検査。

1 ファイルあたりの行数に予算（500 行）を定め、ラチェット方式で悪化のみをブロックする。
ベースライン登録済みファイルは記録値を 1 行でも超えたら FAIL、未登録ファイルは予算を
超えたら FAIL。ベースラインにあるがファイルが存在しない陳腐エントリも FAIL。

モード:
  引数なし           検査（CI が実行する）
  --update           ベースラインの縮小・陳腐エントリ削除を反映してファイルを書く
  --init             初期ベースラインを生成してファイルを書く（初回限定）
  --print-baseline   現状の予算超過ファイルを JSON で stdout に出す（点検専用）

依存: Python 標準ライブラリのみ（CI では uv 不要で python 直接実行可）。
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from fnmatch import fnmatch
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

BUDGET = 500
TARGET_SUFFIXES = (".py", ".ts", ".sh")
# 生成物は検査対象外（scripts/lib/generate_init.py が生成し、production 環境では
# テーブル数に比例して肥大するため、人が分割できる対象ではない）
EXCLUDE_GLOBS = ("postgres/init/*/load-data.py",)
BASELINE_PATH = ROOT / "scripts" / "file-size-baseline.json"


def iter_source_files(root: Path) -> list[str]:
    """git ls-files から対象ファイルを収集する。

    -z で NUL 区切り出力を使い、非 ASCII パスの C クォートを回避する。
    """
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    raw = result.stdout.decode("utf-8")
    entries = [e for e in raw.split("\0") if e]

    files = []
    for entry in entries:
        if not entry.endswith(TARGET_SUFFIXES):
            continue
        if any(fnmatch(entry, pat) for pat in EXCLUDE_GLOBS):
            continue
        files.append(entry)
    return files


def count_lines(path: Path) -> int:
    """ファイルの物理行数を返す。"""
    with open(path, encoding="utf-8", errors="replace") as f:
        return sum(1 for _ in f)


def evaluate(counts: dict[str, int], baseline: dict[str, int]) -> tuple[list[str], list[str]]:
    """予算・ベースラインに対する判定を行う。

    Returns:
        (errors, hints) のタプル。errors が空なら検査合格。
    """
    errors: list[str] = []
    hints: list[str] = []

    for path, n in sorted(counts.items()):
        if path in baseline:
            b = baseline[path]
            if n > b:
                errors.append(f"{path}: {n} 行（ベースライン {b} 行を超過）")
            elif n < b:
                hints.append(f"{path}: {n} 行（ベースライン {b} 行より縮小。--update で反映できます）")
        else:
            if n > BUDGET:
                errors.append(f"{path}: {n} 行（予算 {BUDGET} 行を超過）")

    # 陳腐エントリ: ベースラインにあるが counts に存在しないパス
    for path in sorted(baseline):
        if path not in counts:
            errors.append(f"{path}: ベースラインに登録されているがファイルが存在しない")

    return errors, hints


def plan_update(counts: dict[str, int], baseline: dict[str, int]) -> tuple[dict[str, int], list[str]]:
    """--update 用: 縮小・陳腐エントリ削除を計画する。

    拡大が必要なエントリが 1 つでもあれば errors を返し、更新を拒否する。
    予算超過の未登録ファイルは追加しない。

    Returns:
        (updated_baseline, errors) のタプル。errors が空なら書き込み可。
    """
    errors: list[str] = []
    updated: dict[str, int] = {}

    for path, b in sorted(baseline.items()):
        if path not in counts:
            # 削除・リネーム・分割されたファイル: エントリを削除
            continue
        n = counts[path]
        if n > b:
            errors.append(
                f"{path}: {n} 行（ベースライン {b} 行を超過）。"
                "緩和は scripts/file-size-baseline.json の該当エントリを"
                "手編集し、理由を PR に書くこと"
            )
        elif n <= BUDGET:
            # 予算以下に縮小: エントリを削除
            continue
        else:
            # 縮小（だが予算超過のまま）: 更新
            updated[path] = n

    return updated, errors


def plan_baseline(counts: dict[str, int]) -> dict[str, int]:
    """予算超過ファイルのみを抽出する（純粋関数）。"""
    return {path: n for path, n in sorted(counts.items()) if n > BUDGET}


def plan_print_baseline(counts: dict[str, int], baseline: dict[str, int]) -> tuple[dict[str, int] | None, list[str]]:
    """--print-baseline 用: ゲートが赤なら出力を拒否する。

    Returns:
        (result_or_none, reasons) のタプル。result が None なら出力拒否。
    """
    errors, _ = evaluate(counts, baseline)
    if errors:
        return None, errors
    return plan_baseline(counts), []


def plan_init(existing_text: str | None, counts: dict[str, int]) -> tuple[dict[str, int] | None, list[str]]:
    """--init 用: 既存ベースラインが非空なら生成を拒否する。

    Args:
        existing_text: 既存ファイルの中身。None ならファイル不存在。

    Returns:
        (result_or_none, reasons) のタプル。result が None なら生成拒否。
    """
    if existing_text is not None and existing_text.strip() != "":
        return None, ["初期生成は 1 回限り。既存ベースラインの更新は --update、緩和は該当エントリの手編集"]
    return plan_baseline(counts), []


def serialize_baseline(data: dict[str, int]) -> str:
    """ベースライン JSON をシリアライズする（唯一のシリアライズ経路）。"""
    return json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def write_baseline(path: Path, data: dict[str, int]) -> None:
    """ベースラインをファイルに書き出す。"""
    path.write_text(serialize_baseline(data), encoding="utf-8")


# ──────────────────────────────────────────────


def _collect_counts(root: Path) -> dict[str, int]:
    """対象ファイルの行数を収集する。"""
    files = iter_source_files(root)
    counts: dict[str, int] = {}
    for rel in files:
        full = root / rel
        if full.is_file():
            counts[rel] = count_lines(full)
    return counts


def _load_baseline(path: Path) -> dict[str, int]:
    """ベースライン JSON を読み込む。"""
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        print(f"NG: {path} の JSON が不正です: {exc}", file=sys.stderr)
        sys.exit(1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="ファイルサイズ予算のラチェット検査")
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--update",
        action="store_true",
        help="ベースラインの縮小・陳腐エントリ削除を反映",
    )
    group.add_argument(
        "--init",
        action="store_true",
        help="初期ベースラインを生成（初回限定）",
    )
    group.add_argument(
        "--print-baseline",
        action="store_true",
        help="現状の予算超過ファイルを JSON で stdout に出す",
    )
    args = parser.parse_args(argv)

    counts = _collect_counts(ROOT)

    if args.init:
        existing_text: str | None = None
        if BASELINE_PATH.exists():
            existing_text = BASELINE_PATH.read_text(encoding="utf-8")
        result, reasons = plan_init(existing_text, counts)
        if result is None:
            for r in reasons:
                print(f"NG: {r}", file=sys.stderr)
            return 1
        write_baseline(BASELINE_PATH, result)
        print(f"OK: ベースラインを生成しました（{len(result)} 件）")
        return 0

    baseline = _load_baseline(BASELINE_PATH)

    if args.update:
        updated, errors = plan_update(counts, baseline)
        if errors:
            print(
                f"NG: 拡大が必要なエントリがあるためベースラインを更新できません（{len(errors)} 件）\n",
                file=sys.stderr,
            )
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            return 1
        write_baseline(BASELINE_PATH, updated)
        removed = len(baseline) - len(updated)
        print(f"OK: ベースラインを更新しました（{len(updated)} 件、{removed} 件削除）")
        return 0

    if args.print_baseline:
        result, reasons = plan_print_baseline(counts, baseline)
        if result is None:
            print("NG: ゲートが赤の状態ではベースラインを出力できません\n", file=sys.stderr)
            for r in reasons:
                print(f"  - {r}", file=sys.stderr)
            return 1
        sys.stdout.write(serialize_baseline(result))
        return 0

    # デフォルト: 検査モード
    errors, hints = evaluate(counts, baseline)
    if errors:
        print(f"NG: ファイルサイズ予算エラー {len(errors)} 件\n", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print(
            "\n対処: ファイルを分割して予算内に収めるか、やむを得ない場合は"
            " scripts/file-size-baseline.json の該当エントリを手編集し、"
            "理由を PR に書くこと。陳腐エントリは --update で削除できます。",
            file=sys.stderr,
        )
        return 1

    if hints:
        print(f"OK: ファイルサイズ予算チェックに問題なし（ヒント {len(hints)} 件）\n")
        for h in hints:
            print(f"  - {h}")
    else:
        print("OK: ファイルサイズ予算チェックに問題なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
