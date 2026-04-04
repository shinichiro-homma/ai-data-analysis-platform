#!/bin/bash
set -euo pipefail

# jupyter_readonly ロール作成（シェルコマンド実行阻止 - レイヤー5）
# SELECT + CREATE TEMP TABLE のみ許可

if [[ -z "${POSTGRES_READONLY_PASSWORD:-}" ]]; then
  echo "WARNING: POSTGRES_READONLY_PASSWORD not set, using insecure default" >&2
fi
readonly READONLY_PASSWORD="${POSTGRES_READONLY_PASSWORD:-readonly_password}"

# psql でロール作成・権限付与を実行
# DO ブロック内では psql 変数が展開されないため、\gexec を使用
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v readonly_pass="$READONLY_PASSWORD" \
  -v dbname="$POSTGRES_DB" <<'EOSQL'
-- ロール作成（既に存在する場合はスキップ）
SELECT format('CREATE ROLE jupyter_readonly LOGIN PASSWORD %L', :'readonly_pass')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'jupyter_readonly')
\gexec

-- 権限付与
GRANT CONNECT ON DATABASE :"dbname" TO jupyter_readonly;
GRANT USAGE ON SCHEMA public TO jupyter_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO jupyter_readonly;
GRANT TEMP ON DATABASE :"dbname" TO jupyter_readonly;

-- 将来作成されるテーブルにも自動で SELECT 権限を付与
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO jupyter_readonly;
EOSQL

echo "jupyter_readonly role configured successfully"
