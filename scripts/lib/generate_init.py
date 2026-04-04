#!/usr/bin/env python3
"""Generate PostgreSQL init scripts (create-tables.sql, load-data.py) from catalog YAML."""

import os
import re
import sys
from datetime import datetime

try:
    import yaml
except ImportError:
    print(
        "ERROR: pyyaml is required.\n  Install with: pip install pyyaml\n  Or: brew install python-yq",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:
    print(
        "ERROR: pyarrow is required.\n  Install with: pip install pyarrow",
        file=sys.stderr,
    )
    sys.exit(1)

VALID_ENVS = {"sample", "production"}


def main():
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <ENV>", file=sys.stderr)
        sys.exit(1)

    env = sys.argv[1]
    if env not in VALID_ENVS:
        print(f"ERROR: invalid env '{env}' (valid: {', '.join(sorted(VALID_ENVS))})", file=sys.stderr)
        sys.exit(1)

    # Paths
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    catalog_dir = os.path.join(project_root, "document-server", "data", env, "catalog")
    output_dir = os.path.join(project_root, "postgres", "init", env)

    # Read index.yaml for table ordering
    index_path = os.path.join(catalog_dir, "index.yaml")
    try:
        with open(index_path) as f:
            index_data = yaml.safe_load(f)
    except (OSError, yaml.YAMLError) as e:
        print(f"ERROR: failed to read {index_path}: {e}", file=sys.stderr)
        sys.exit(1)

    # Read table YAMLs (only postgresql type, in index order)
    tables = []
    for entry in index_data["tables_index"]:
        table_name = entry["table_name"]
        # Reject table names with dangerous characters (SQL injection prevention)
        if re.search(r"[;'\"\\)\s]|--", table_name):
            print(f"  ERROR: invalid table_name '{table_name}', skipping", file=sys.stderr)
            continue
        table_path = os.path.join(catalog_dir, "tables", f"{table_name}.yaml")

        if not os.path.exists(table_path):
            print(f"  WARNING: {table_path} not found, skipping", file=sys.stderr)
            continue

        try:
            with open(table_path) as f:
                table_data = yaml.safe_load(f)
        except (OSError, yaml.YAMLError) as e:
            print(f"  ERROR: failed to read {table_path}: {e}", file=sys.stderr)
            continue

        ds_type = table_data.get("data_source", {}).get("type", "")
        if ds_type != "postgresql":
            print(f"  Skipping {table_name} (data_source.type: {ds_type})")
            continue

        tables.append(table_data)
        print(f"  Loading {table_name} ({entry['display_name']})")

    if not tables:
        print("  No postgresql tables found in catalog (all tables may be csv/external type)")
        print("  Generating empty init scripts.")

    # Read Parquet schema to filter columns that exist in actual data
    data_dir = os.path.join(project_root, "postgres", "data", env)
    parquet_columns = read_parquet_columns(data_dir, tables)

    # Filter table columns to match Parquet (for both CREATE TABLE and COPY)
    for table in tables:
        pg_table = table["data_source"]["table"]
        parquet_cols = parquet_columns.get(pg_table)
        if parquet_cols is not None:
            parquet_col_set = set(parquet_cols)
            original_cols = table["columns"]
            filtered = []
            skipped = []
            for col in original_cols:
                # SERIAL columns are auto-generated, always include in CREATE TABLE
                if col["type"].lower() == "serial" or col["name"] in parquet_col_set:
                    filtered.append(col)
                else:
                    skipped.append(col["name"])
            if skipped:
                print(
                    f"  WARNING: {pg_table}: columns not in Parquet, skipped: {skipped}",
                    file=sys.stderr,
                )
            table["columns"] = filtered

    # Detect timestamp-as-string columns
    timestamp_str_columns = detect_timestamp_str_columns(tables, parquet_columns, data_dir)

    # Generate
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sql = generate_create_tables(tables, timestamp, parquet_columns)
    load_data_script = generate_load_data(tables, env, timestamp, parquet_columns, timestamp_str_columns)

    # Write
    os.makedirs(output_dir, exist_ok=True)

    sql_path = os.path.join(output_dir, "create-tables.sql")
    with open(sql_path, "w") as f:
        f.write(sql)

    py_path = os.path.join(output_dir, "load-data.py")
    with open(py_path, "w") as f:
        f.write(load_data_script)
    os.chmod(py_path, 0o755)

    # Remove old load-data.sh if it exists
    old_sh_path = os.path.join(output_dir, "load-data.sh")
    if os.path.exists(old_sh_path):
        os.remove(old_sh_path)
        print(f"  Removed old: {os.path.relpath(old_sh_path, project_root)}")

    # Report
    print("")
    print("Generated:")
    print(f"  {os.path.relpath(sql_path, project_root)}")
    print(f"  {os.path.relpath(py_path, project_root)}")


# ---------------------------------------------------------------------------
# SQL generation
# ---------------------------------------------------------------------------


def generate_create_tables(tables, timestamp, parquet_columns):
    lines = [
        "-- Auto-generated from catalog YAML. DO NOT EDIT MANUALLY.",
        f"-- Generated at: {timestamp}",
        "",
    ]

    for table in tables:
        pg_table = table["data_source"]["table"]
        display_name = table["display_name"]
        columns = table["columns"]

        # Skip tables without Parquet data
        if parquet_columns.get(pg_table) is None:
            print(f"  INFO: {pg_table}: Parquet not found, skipping CREATE TABLE")
            continue

        lines.append(f"-- {pg_table}: {display_name}")
        lines.append(f"CREATE TABLE IF NOT EXISTS {quote_ident(pg_table)} (")

        col_defs = []
        for col in columns:
            col_defs.append(format_column_def(col))

        lines.append(",\n".join(f"    {d}" for d in col_defs))
        lines.append(");")
        lines.append("")

    return "\n".join(lines)


def format_column_def(col):
    """Build a single column definition line."""
    name = quote_ident(col["name"])
    col_type = col["type"].upper()
    parts = [name, col_type]

    if col.get("nullable") is False:
        parts.append("NOT NULL")

    return " ".join(parts)


def quote_ident(name: str) -> str:
    """Double-quote an identifier for PostgreSQL (escapes embedded double quotes)."""
    return '"' + name.replace('"', '""') + '"'


# ---------------------------------------------------------------------------
# Parquet schema reading
# ---------------------------------------------------------------------------


def read_parquet_columns(data_dir, tables):
    """Read Parquet schema to determine COPY column lists."""
    columns = {}
    for table in tables:
        pg_table = table["data_source"]["table"]
        parquet_path = os.path.join(data_dir, f"{pg_table}.parquet")
        if os.path.exists(parquet_path):
            schema = pq.read_schema(parquet_path)
            columns[pg_table] = schema.names
        else:
            columns[pg_table] = None
    return columns


# Catalog types that represent date/timestamp semantics
_TIMESTAMP_CATALOG_TYPES = {
    "date",
    "timestamp",
    "timestamp without time zone",
    "timestamp with time zone",
    "timestamptz",
}


def detect_timestamp_str_columns(tables, parquet_columns, data_dir):
    """Detect columns that are timestamp/date in catalog YAML but string in Parquet.

    Returns dict: pg_table -> list of column names.
    """
    result = {}
    for table in tables:
        pg_table = table["data_source"]["table"]
        pq_cols = parquet_columns.get(pg_table)
        if pq_cols is None:
            continue

        # Read Parquet schema for type info
        parquet_path = os.path.join(data_dir, f"{pg_table}.parquet")
        schema = pq.read_schema(parquet_path)
        pq_type_map = {f.name: f.type for f in schema}

        ts_str_cols = []
        for col in table["columns"]:
            col_name = col["name"]
            catalog_type = col["type"].lower().strip()
            pq_type = pq_type_map.get(col_name)
            if pq_type is None:
                continue
            if catalog_type in _TIMESTAMP_CATALOG_TYPES and (
                pa.types.is_string(pq_type) or pa.types.is_large_string(pq_type)
            ):
                ts_str_cols.append(col_name)

        if ts_str_cols:
            result[pg_table] = ts_str_cols
            print(f"  INFO: {pg_table}: timestamp-as-string columns: {ts_str_cols}")

    return result


# ---------------------------------------------------------------------------
# Python script generation
# ---------------------------------------------------------------------------


def generate_load_data(tables, env, timestamp, parquet_columns, timestamp_str_columns=None):
    """Generate a Python script (load-data.py) that loads Parquet data into PostgreSQL."""
    if timestamp_str_columns is None:
        timestamp_str_columns = {}

    # Filter tables with/without Parquet files
    loadable_tables = []
    missing_parquet_tables = []
    for table in tables:
        pg_table = table["data_source"]["table"]
        if parquet_columns.get(pg_table) is not None:
            loadable_tables.append(table)
        else:
            missing_parquet_tables.append(table)

    if missing_parquet_tables:
        for table in missing_parquet_tables:
            pg_table = table["data_source"]["table"]
            print(
                f"  WARNING: {pg_table}.parquet not found, skipping in load-data.py",
                file=sys.stderr,
            )

    # Build TABLES list entries
    table_entries = []
    for table in loadable_tables:
        pg_table = table["data_source"]["table"]
        cols = parquet_columns[pg_table]
        # Exclude SERIAL columns from COPY
        serial_cols = {col["name"] for col in table["columns"] if col["type"].lower() == "serial"}
        copy_cols = [c for c in cols if c not in serial_cols]
        # Generate Python source with double-quoted identifiers for PostgreSQL
        cols_repr = ", ".join(f"'{quote_ident(c)}'" for c in copy_cols)
        # Add timestamp_str_columns if present
        ts_cols = timestamp_str_columns.get(pg_table, [])
        ts_repr = ", ".join(f'"{c}"' for c in ts_cols)
        table_entries.append(
            f'    {{\n        "name": "{pg_table}",\n        "columns": [{cols_repr}],'
            f'\n        "timestamp_str_columns": [{ts_repr}],'
            f"\n    }},"
        )

    tables_block = "\n".join(table_entries)

    script = f'''#!/usr/bin/env python3
# Auto-generated from catalog YAML. DO NOT EDIT MANUALLY.
# Generated at: {timestamp}

import io
import os
import sys

import psycopg2
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "{env}"))

TABLES = [
{tables_block}
]


def main():
    if "PGPASSWORD" not in os.environ:
        print("ERROR: PGPASSWORD environment variable is required", file=sys.stderr)
        sys.exit(1)

    conn = psycopg2.connect(
        host=os.environ.get("PGHOST", "localhost"),
        port=os.environ.get("PGPORT", "5432"),
        user=os.environ.get("PGUSER", "jupyter"),
        password=os.environ["PGPASSWORD"],
        dbname=os.environ.get("PGDATABASE", "analysis_db"),
    )

    try:
        cur = conn.cursor()

        # Performance tuning for bulk load
        cur.execute("SET maintenance_work_mem = '256MB'")
        cur.execute("SET synchronous_commit = OFF")
        conn.commit()

        for table in TABLES:
            load_table(conn, cur, table)

        # Restore default settings
        cur.execute("SET maintenance_work_mem = DEFAULT")
        cur.execute("SET synchronous_commit = ON")
        conn.commit()

        # Grant SELECT on all tables to jupyter_readonly role
        cur.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO jupyter_readonly")
        conn.commit()

        print("All tables loaded successfully.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def load_table(conn, cur, table_def):
    name = table_def["name"]
    columns = table_def["columns"]
    ts_str_columns = set(table_def.get("timestamp_str_columns", []))
    parquet_path = os.path.join(DATA_DIR, f"{{name}}.parquet")

    if not os.path.exists(parquet_path):
        raise FileNotFoundError(f"{{parquet_path}} not found")

    CHUNK_SIZE = 300_000
    pf = pq.ParquetFile(parquet_path)
    strip_cols = [c.strip(\'"\') for c in columns]
    cols_str = ", ".join(columns)
    total_rows = 0

    # Pre-compute column indices for cleaning
    schema = pf.schema_arrow
    string_col_indices = [
        i for i, f in enumerate(schema)
        if f.name in strip_cols and (pa.types.is_string(f.type) or pa.types.is_large_string(f.type))
    ]
    ts_str_col_indices = [
        i for i, f in enumerate(schema)
        if f.name in ts_str_columns
    ]

    # Regex to extract valid datetime portion from timestamp strings
    # Matches: 2024-01-15T10:30:00, 2024-01-15 10:30:00.123456, etc.
    TS_PATTERN = r"^(?P<ts>\\d{{4}}-\\d{{2}}-\\d{{2}}[T ]\\d{{2}}:\\d{{2}}:\\d{{2}}(?:\\.\\d{{1,6}})?(?:[+-]\\d{{2}}:?\\d{{2}}|Z)?)"

    for batch in pf.iter_batches(batch_size=CHUNK_SIZE, columns=strip_cols):
        arrays = list(batch.columns)

        # Clean string columns: replace empty strings with null
        if string_col_indices:
            for i in string_col_indices:
                col = arrays[i]
                is_empty = pc.equal(col, "")
                arrays[i] = pc.if_else(is_empty, None, col)

        # Clean timestamp-as-string columns: extract valid datetime portion
        if ts_str_col_indices:
            for i in ts_str_col_indices:
                col = arrays[i]
                extracted = pc.extract_regex(col, TS_PATTERN)
                # extract_regex returns struct with named field; use it or null
                arrays[i] = pc.struct_field(extracted, "ts")

        if string_col_indices or ts_str_col_indices:
            batch = pa.RecordBatch.from_arrays(arrays, schema=batch.schema)

        buf = io.BytesIO()
        pa_csv.write_csv(pa.Table.from_batches([batch]), buf)
        buf.seek(0)

        copy_sql = f'COPY "{{name}}"({{cols_str}}) FROM STDIN WITH (FORMAT csv, HEADER true' + ", NULL ''" + f', FORCE_NULL ({{cols_str}}))'
        cur.copy_expert(copy_sql, buf)
        total_rows += batch.num_rows

        if total_rows % (CHUNK_SIZE * 10) == 0 and total_rows > 0:
            print(f"  {{name}}: {{total_rows:,}} rows loaded...", flush=True)

    conn.commit()
    print(f"  Loaded {{name}}: {{total_rows:,}} rows")


if __name__ == "__main__":
    main()
'''
    return script


if __name__ == "__main__":
    main()
