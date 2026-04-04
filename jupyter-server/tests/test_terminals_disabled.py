"""Terminals API 無効化テスト

jupyter_server_config.py に terminals_enabled = False が設定されていることを検証する。

タスク 31.4: Terminals API 無効化（シェルコマンド実行阻止 - レイヤー2）
- ターミナル経由のシェルアクセスを防止する
"""

from pathlib import Path

_config_path = (
    Path(__file__).resolve().parent.parent
    / "jupyter_config"
    / "jupyter_server_config.py"
)


def _read_config() -> str:
    return _config_path.read_text(encoding="utf-8")


class TestTerminalsDisabled:
    """Terminals API が無効化されていることを検証するテスト"""

    def test_config_file_exists(self):
        """設定ファイルが存在する"""
        assert _config_path.exists(), f"設定ファイルが見つかりません: {_config_path}"

    def test_terminals_enabled_present(self):
        """設定ファイルに terminals_enabled が含まれる"""
        content = _read_config()
        assert "terminals_enabled" in content, (
            "jupyter_server_config.py に terminals_enabled が見つかりません"
        )

    def test_terminals_enabled_is_false(self):
        """terminals_enabled が False に設定されている"""
        content = _read_config()
        # 各行を検査して terminals_enabled = False の行が存在することを確認
        found = False
        for line in content.splitlines():
            stripped = line.strip()
            # コメント行をスキップ
            if stripped.startswith("#"):
                continue
            if "terminals_enabled" in stripped and "False" in stripped:
                found = True
                break
        assert found, (
            "jupyter_server_config.py に `terminals_enabled = False` の設定が見つかりません"
        )

    def test_terminals_enabled_not_true(self):
        """terminals_enabled が True に設定されていない（コメント行を除く）"""
        content = _read_config()
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                continue
            if "terminals_enabled" in stripped:
                assert "True" not in stripped, (
                    f"terminals_enabled が True に設定されています: {line!r}"
                )
