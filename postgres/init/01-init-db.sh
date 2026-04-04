#!/bin/bash
set -euo pipefail

# DATA_ENV: sample (default) or production
readonly DATA_ENV="${DATA_ENV:-sample}"

# Validate DATA_ENV
case "$DATA_ENV" in
    sample|production) ;;
    *)
        echo "ERROR: Invalid DATA_ENV='$DATA_ENV'. Must be 'sample' or 'production'" >&2
        exit 1
        ;;
esac

readonly INIT_DIR="/docker-entrypoint-initdb.d/${DATA_ENV}"

echo "=== Initializing database with DATA_ENV=${DATA_ENV} ==="

# Check required directory and files
if [ ! -d "${INIT_DIR}" ]; then
    echo "ERROR: Directory ${INIT_DIR} not found" >&2
    exit 1
fi

if [ ! -f "${INIT_DIR}/create-tables.sql" ]; then
    echo "ERROR: ${INIT_DIR}/create-tables.sql not found" >&2
    echo "Hint: For production, run 'scripts/generate-init-scripts.sh production' first." >&2
    exit 1
fi

# Execute table creation
echo "--- Running create-tables.sql ---"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "${INIT_DIR}/create-tables.sql"

# Grant permissions to jupyter_readonly role
# GRANT TEMP は 00-create-roles.sh で付与済みのため、ここでは省略する。
# GRANT SELECT はテーブル作成後に再付与することで、新規テーブルへの権限を確実に付与する。
echo "--- Granting permissions to jupyter_readonly ---"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO jupyter_readonly;"

echo "=== Tables created. Data will be loaded from host via load-data.py. ==="
