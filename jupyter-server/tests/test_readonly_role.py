"""PostgreSQL read-only ロール（SQL防御）設定検証テスト

タスク 31.5: PostgreSQL read-only ロール（SQL防御）
- jupyter_readonly ロールの作成スクリプトが存在すること
- docker-compose.yml の DATABASE_URL が jupyter_readonly ユーザーを使用していること
- 01-init-db.sh に GRANT SELECT が含まれること
- generate_init.py の出力に GRANT SELECT が含まれること
- .env.example に POSTGRES_READONLY_PASSWORD が含まれること

Docker 不要の設定検証テスト（TDD Red フェーズ）。
"""

import re
from pathlib import Path

# プロジェクトルート（テストファイルから見て jupyter-server/tests/ → ../../）
_project_root = Path(__file__).resolve().parent.parent.parent

_docker_compose_path = _project_root / "docker-compose.yml"
_roles_script_path = _project_root / "postgres" / "init" / "00-create-roles.sh"
_init_db_path = _project_root / "postgres" / "init" / "01-init-db.sh"
_generate_init_path = _project_root / "scripts" / "lib" / "generate_init.py"
_env_example_path = _project_root / ".env.example"


class TestRolesScriptExists:
    """00-create-roles.sh の存在と内容を検証"""

    def test_roles_script_exists(self):
        """ロール作成スクリプトが存在する"""
        assert _roles_script_path.exists(), (
            f"ロール作成スクリプトが見つかりません: {_roles_script_path}"
        )

    def test_roles_script_creates_jupyter_readonly(self):
        """スクリプトが jupyter_readonly ロールを作成する"""
        content = _roles_script_path.read_text(encoding="utf-8")
        assert "jupyter_readonly" in content, (
            "00-create-roles.sh に jupyter_readonly ロールの作成が見つかりません"
        )

    def test_roles_script_grants_login(self):
        """jupyter_readonly ロールに LOGIN 権限がある"""
        content = _roles_script_path.read_text(encoding="utf-8")
        # CREATE ROLE ... LOGIN or ALTER ROLE ... LOGIN
        assert re.search(r"(?i)(CREATE|ALTER)\s+ROLE.*jupyter_readonly.*LOGIN", content), (
            "jupyter_readonly ロールに LOGIN 権限が設定されていません"
        )

    def test_roles_script_no_superuser(self):
        """jupyter_readonly ロールに SUPERUSER 権限がない"""
        content = _roles_script_path.read_text(encoding="utf-8")
        # NOSUPERUSER が含まれるか、SUPERUSER が含まれない
        has_superuser = re.search(
            r"(?i)CREATE\s+ROLE.*jupyter_readonly.*\bSUPERUSER\b", content
        )
        if has_superuser:
            # NOSUPERUSER なら OK
            assert re.search(
                r"(?i)CREATE\s+ROLE.*jupyter_readonly.*NOSUPERUSER", content
            ), "jupyter_readonly ロールに SUPERUSER 権限が設定されています"


class TestDockerComposeReadonly:
    """docker-compose.yml の DATABASE_URL が jupyter_readonly を使用していることを検証"""

    def test_database_url_uses_readonly_user(self):
        """DATABASE_URL が jupyter_readonly ユーザーを含む"""
        content = _docker_compose_path.read_text(encoding="utf-8")
        # DATABASE_URL=postgresql://jupyter_readonly:... のパターン
        assert re.search(
            r"DATABASE_URL=postgresql://.*jupyter_readonly", content
        ), (
            "docker-compose.yml の DATABASE_URL が jupyter_readonly ユーザーを使用していません"
        )

    def test_readonly_password_variable_exists(self):
        """POSTGRES_READONLY_PASSWORD 変数が docker-compose.yml で参照されている"""
        content = _docker_compose_path.read_text(encoding="utf-8")
        assert "POSTGRES_READONLY_PASSWORD" in content, (
            "docker-compose.yml に POSTGRES_READONLY_PASSWORD の参照が見つかりません"
        )


class TestInitDbGrantSelect:
    """01-init-db.sh に GRANT SELECT が含まれることを検証"""

    def test_grant_select_present(self):
        """GRANT SELECT 文が存在する"""
        content = _init_db_path.read_text(encoding="utf-8")
        assert re.search(r"(?i)GRANT\s+SELECT", content), (
            "01-init-db.sh に GRANT SELECT が見つかりません"
        )

    def test_grant_to_jupyter_readonly(self):
        """GRANT が jupyter_readonly ロールに対して行われる"""
        content = _init_db_path.read_text(encoding="utf-8")
        assert re.search(r"(?i)GRANT.*jupyter_readonly", content), (
            "01-init-db.sh に jupyter_readonly への GRANT が見つかりません"
        )

    def test_grant_create_temp(self):
        """CREATE TEMP TABLE 権限が付与される（一時テーブル用）"""
        content = _init_db_path.read_text(encoding="utf-8")
        assert re.search(r"(?i)GRANT.*TEMP", content) or re.search(
            r"(?i)GRANT.*TEMPORARY", content
        ), (
            "01-init-db.sh に TEMP/TEMPORARY テーブル作成権限の GRANT が見つかりません"
        )


class TestGenerateInitGrantSelect:
    """generate_init.py が GRANT SELECT を生成することを検証"""

    def test_generate_init_contains_grant_select(self):
        """generate_init.py に GRANT SELECT の生成ロジックがある"""
        content = _generate_init_path.read_text(encoding="utf-8")
        assert re.search(r"(?i)GRANT\s+SELECT", content), (
            "generate_init.py に GRANT SELECT の生成ロジックが見つかりません"
        )

    def test_generate_init_references_jupyter_readonly(self):
        """generate_init.py が jupyter_readonly を参照している"""
        content = _generate_init_path.read_text(encoding="utf-8")
        assert "jupyter_readonly" in content, (
            "generate_init.py に jupyter_readonly の参照が見つかりません"
        )


class TestEnvExampleReadonlyPassword:
    """.env.example に POSTGRES_READONLY_PASSWORD が含まれることを検証"""

    def test_readonly_password_in_env_example(self):
        """POSTGRES_READONLY_PASSWORD が .env.example に存在する"""
        content = _env_example_path.read_text(encoding="utf-8")
        assert "POSTGRES_READONLY_PASSWORD" in content, (
            ".env.example に POSTGRES_READONLY_PASSWORD が見つかりません"
        )
