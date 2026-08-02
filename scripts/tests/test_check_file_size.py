"""scripts/check-file-size.py の判定ロジックのテスト（全 20 ケース）

ケース 1-11: 純粋関数テスト（辞書リテラルで直接呼ぶ。ファイル I/O なし）
ケース 12-17: _load_baseline() テスト（tmp_path で一時ファイル I/O）
ケース 18-20: 実リポジトリに対するテスト

依存: pytest のみ（scripts/check-file-size.py は標準ライブラリのみ）
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "check-file-size.py"

# ハイフン入りファイル名のため importlib で直接ロード
# （jupyter-server/tests/test_workspace_cwd_resolution.py:133-145 と同じ形）
_mod = None
if _SCRIPT_PATH.exists():
    _spec = importlib.util.spec_from_file_location("check_file_size", _SCRIPT_PATH)
    if _spec and _spec.loader:
        _mod = importlib.util.module_from_spec(_spec)
        sys.modules["check_file_size"] = _mod
        _spec.loader.exec_module(_mod)

_NOT_IMPLEMENTED = "scripts/check-file-size.py が未実装"


class TestEvaluate:
    """evaluate() の判定テスト"""

    def test_passes_when_all_files_within_budget(self) -> None:
        """正常系: 全ファイルが予算内・ベースライン空 -> errors・hints ともに空"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/a.py": 100, "src/b.ts": 499, "scripts/c.sh": 500}
        baseline: dict[str, int] = {}
        errors, hints = _mod.evaluate(counts, baseline)
        assert errors == []
        assert hints == []

    def test_fails_for_unlisted_file_over_budget(self) -> None:
        """異常系: 未登録ファイルが 501 行 -> errors 1 件、メッセージにパスと行数"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/big.py": 501}
        baseline: dict[str, int] = {}
        errors, hints = _mod.evaluate(counts, baseline)
        assert len(errors) == 1
        assert "src/big.py" in errors[0]
        assert "501" in errors[0]

    def test_passes_when_baselined_file_unchanged(self) -> None:
        """境界値: 登録済みファイルが記録値ちょうど -> errors 空"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/large.py": 890}
        baseline = {"src/large.py": 890}
        errors, hints = _mod.evaluate(counts, baseline)
        assert errors == []

    def test_fails_when_baselined_file_grows_by_one_line(self) -> None:
        """異常系: 登録済み 890 行が 891 行 -> errors 1 件（境界値）"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/large.py": 891}
        baseline = {"src/large.py": 890}
        errors, hints = _mod.evaluate(counts, baseline)
        assert len(errors) == 1
        assert "src/large.py" in errors[0]

    def test_hints_when_baselined_file_shrinks(self) -> None:
        """登録済み 890 行が 800 行 -> errors 空・hints 1 件"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/large.py": 800}
        baseline = {"src/large.py": 890}
        errors, hints = _mod.evaluate(counts, baseline)
        assert errors == []
        assert len(hints) == 1
        assert "src/large.py" in hints[0]

    def test_fails_for_stale_baseline_entry(self) -> None:
        """異常系: ベースラインにあるパスが counts に存在しない -> errors 1 件"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts: dict[str, int] = {}
        baseline = {"src/deleted.py": 600}
        errors, hints = _mod.evaluate(counts, baseline)
        assert len(errors) == 1
        assert "src/deleted.py" in errors[0]


class TestPlanUpdate:
    """plan_update() のテスト"""

    def test_update_shrinks_and_drops_entries(self) -> None:
        """縮小->更新、予算以下->削除、消失->削除、未登録超過->追加しない"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {
            "src/shrunk.py": 800,  # 890->800: 更新
            "src/fixed.py": 480,  # 520->480（予算以下）: 削除
            # "src/gone.py" は counts に存在しない: 削除
            "src/new_big.py": 600,  # 未登録・予算超過: 追加しない
        }
        baseline = {
            "src/shrunk.py": 890,
            "src/fixed.py": 520,
            "src/gone.py": 700,
        }
        updated, errors = _mod.plan_update(counts, baseline)
        assert errors == []
        assert updated == {"src/shrunk.py": 800}

    def test_update_refuses_to_grow(self) -> None:
        """異常系: 登録済み 890->891 が 1 件でもあれば拒否"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {
            "src/grew.py": 891,
            "src/shrunk.py": 800,
        }
        baseline = {
            "src/grew.py": 890,
            "src/shrunk.py": 890,
        }
        _, errors = _mod.plan_update(counts, baseline)
        assert len(errors) > 0


class TestPlanBaseline:
    """plan_baseline() / plan_print_baseline() / plan_init() のテスト"""

    def test_plan_baseline_lists_only_over_budget(self) -> None:
        """plan_baseline は予算超過ファイルのみを返す"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {
            "src/small.py": 100,
            "src/ok.py": 500,
            "src/big.py": 501,
            "src/huge.py": 890,
        }
        result = _mod.plan_baseline(counts)
        assert result == {"src/big.py": 501, "src/huge.py": 890}

    def test_print_baseline_refuses_when_gate_is_red(self) -> None:
        """異常系: ゲートが赤なら None（3 パターン）。緑なら dict を返す"""
        assert _mod is not None, _NOT_IMPLEMENTED

        # パターン 1: ベースライン登録済みが拡大
        counts_grow = {"src/a.py": 891}
        baseline_grow = {"src/a.py": 890}
        result, _ = _mod.plan_print_baseline(counts_grow, baseline_grow)
        assert result is None, "拡大時に None を返すべき"

        # パターン 2: 予算超過の未登録ファイル
        counts_unlisted = {"src/new.py": 600}
        baseline_unlisted: dict[str, int] = {}
        result, _ = _mod.plan_print_baseline(counts_unlisted, baseline_unlisted)
        assert result is None, "未登録超過時に None を返すべき"

        # パターン 3: 陳腐エントリ
        counts_stale: dict[str, int] = {}
        baseline_stale = {"src/gone.py": 700}
        result, _ = _mod.plan_print_baseline(counts_stale, baseline_stale)
        assert result is None, "陳腐エントリ時に None を返すべき"

        # 緑の状態: plan_baseline() と同じ dict を返す
        counts_green = {"src/small.py": 100, "src/big.py": 501}
        baseline_green = {"src/big.py": 501}
        result, _ = _mod.plan_print_baseline(counts_green, baseline_green)
        expected = _mod.plan_baseline(counts_green)
        assert result == expected

    def test_init_refuses_when_baseline_is_not_empty(self) -> None:
        """異常系: 非空テキストで None、None と空文字で plan_baseline と同じ dict"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/big.py": 600, "src/small.py": 100}
        expected = _mod.plan_baseline(counts)

        # 非空: 拒否
        result, _ = _mod.plan_init('{"a": 900}', counts)
        assert result is None, "非空テキストで None を返すべき"

        # None（ファイル不存在）: 許可
        result, _ = _mod.plan_init(None, counts)
        assert result == expected

        # 空文字（空ファイル）: 許可
        result, _ = _mod.plan_init("", counts)
        assert result == expected

    def test_init_accepts_whitespace_only_baseline(self) -> None:
        """空白のみのテキストは「ベースラインなし」扱いで plan_baseline と同じ dict を返す"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {"src/big.py": 600, "src/small.py": 100}
        expected_result, expected_reasons = _mod.plan_baseline(counts), []
        result, reasons = _mod.plan_init("\n", counts)
        assert result == expected_result
        assert reasons == expected_reasons

    def test_init_generates_baseline_when_none_exists(self) -> None:
        """None（ファイル不存在）で予算超過ファイルのみのベースラインを正しく返す"""
        assert _mod is not None, _NOT_IMPLEMENTED
        counts = {
            "src/small.py": 100,
            "src/ok.py": 500,
            "src/big.py": 501,
            "src/huge.py": 890,
        }
        result, reasons = _mod.plan_init(None, counts)
        assert result == {"src/big.py": 501, "src/huge.py": 890}
        assert reasons == []


class TestLoadBaseline:
    """_load_baseline() の純粋関数テスト（一時ファイルで I/O）"""

    def test_missing_file_returns_empty_dict(self, tmp_path: Path) -> None:
        """ファイル不存在は空 dict・エラーなし"""
        assert _mod is not None, _NOT_IMPLEMENTED
        result, error = _mod._load_baseline(tmp_path / "no-such-file.json")
        assert result == {}
        assert error is None

    def test_empty_file_returns_empty_dict(self, tmp_path: Path) -> None:
        """空ファイル（空白のみ含む）は空 dict・エラーなし"""
        assert _mod is not None, _NOT_IMPLEMENTED
        path = tmp_path / "empty.json"
        path.write_text("  \n", encoding="utf-8")
        result, error = _mod._load_baseline(path)
        assert result == {}
        assert error is None

    def test_valid_json_returns_dict(self, tmp_path: Path) -> None:
        """正常な JSON はパース結果の dict・エラーなし"""
        assert _mod is not None, _NOT_IMPLEMENTED
        path = tmp_path / "baseline.json"
        path.write_text('{"src/a.py": 600}', encoding="utf-8")
        result, error = _mod._load_baseline(path)
        assert result == {"src/a.py": 600}
        assert error is None

    def test_invalid_json_returns_error(self, tmp_path: Path) -> None:
        """JSON パースエラーは None・エラーメッセージ"""
        assert _mod is not None, _NOT_IMPLEMENTED
        path = tmp_path / "broken.json"
        path.write_text("{not valid json", encoding="utf-8")
        result, error = _mod._load_baseline(path)
        assert result is None
        assert error is not None

    def test_non_dict_json_returns_error(self, tmp_path: Path) -> None:
        """トップレベルが dict でない場合は None・エラーメッセージ"""
        assert _mod is not None, _NOT_IMPLEMENTED
        path = tmp_path / "list.json"
        path.write_text("[1, 2, 3]", encoding="utf-8")
        result, error = _mod._load_baseline(path)
        assert result is None
        assert error is not None

    def test_non_int_value_returns_error(self, tmp_path: Path) -> None:
        """値が int でない場合は None・エラーメッセージ"""
        assert _mod is not None, _NOT_IMPLEMENTED
        path = tmp_path / "bad-value.json"
        path.write_text('{"src/a.py": "not-an-int"}', encoding="utf-8")
        result, error = _mod._load_baseline(path)
        assert result is None
        assert error is not None


class TestIterSourceFiles:
    """iter_source_files() の実リポジトリテスト"""

    def test_excludes_generated_load_data(self) -> None:
        """postgres/init/sample/load-data.py を除外し、check-docs-consistency.py を含む"""
        assert _mod is not None, _NOT_IMPLEMENTED
        files = _mod.iter_source_files(_REPO_ROOT)
        assert "postgres/init/sample/load-data.py" not in files
        # 追跡済みファイルで存在確認（check-file-size.py は未追跡の可能性あり）
        assert "scripts/check-docs-consistency.py" in files

    def test_returns_unquoted_paths(self) -> None:
        """パスが C クォートされておらず、対象拡張子のみを含む"""
        assert _mod is not None, _NOT_IMPLEMENTED
        files = _mod.iter_source_files(_REPO_ROOT)
        for f in files:
            assert not f.startswith('"'), f"C クォート形式のパス: {f}"
        valid_suffixes = (".py", ".ts", ".sh")
        for f in files:
            assert any(f.endswith(s) for s in valid_suffixes), f"対象外の拡張子: {f}"


class TestGateAgainstRealRepo:
    """実リポジトリに対するゲート回帰テスト"""

    def test_real_repository_is_green(self) -> None:
        """ゲートが exit 0 かつ対象ファイルが 200 件以上"""
        # subprocess でゲート本体を起動
        # （test_workspace_cwd_resolution.py:242-274 と同じパターン）
        command = ["uv", "run", "python", "scripts/check-file-size.py"]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                cwd=str(_REPO_ROOT),
                check=False,
            )
        except FileNotFoundError:
            pytest.skip("uv が未インストールのため skip")

        # returncode 0 以外は skip せず fail させる
        assert result.returncode == 0, (
            f"returncode が 0 ではない: {result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

        # iter_source_files の件数で無言グリーンを検知
        assert _mod is not None, _NOT_IMPLEMENTED
        files = _mod.iter_source_files(_REPO_ROOT)
        assert len(files) >= 200, f"iter_source_files が {len(files)} 件しか返さない（無言グリーンの疑い）"
