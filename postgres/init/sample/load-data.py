#!/usr/bin/env python3
# Auto-generated from catalog YAML. DO NOT EDIT MANUALLY.
# Generated at: 2026-03-24 09:42:20

import io
import os
import sys

import psycopg2
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as pa_csv
import pyarrow.parquet as pq

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data", "sample"))

TABLES = [
    {
        "name": "customer_master",
        "columns": ['"customer_id"', '"customer_name"', '"gender"', '"birth_date"', '"postal_code"', '"prefecture"', '"loyalty_rank"', '"registration_date"', '"email"', '"phone"'],
        "timestamp_str_columns": [],
    },
    {
        "name": "product_master",
        "columns": ['"product_code"', '"product_name"', '"jan_code"', '"category_large"', '"category_medium"', '"category_small"', '"unit_price"', '"cost_price"', '"supplier_name"', '"is_active"', '"registered_date"'],
        "timestamp_str_columns": [],
    },
    {
        "name": "purchase_history",
        "columns": ['"transaction_id"', '"customer_id"', '"product_code"', '"transaction_date"', '"transaction_time"', '"quantity"', '"unit_price"', '"amount"', '"discount_amount"', '"store_code"', '"channel"', '"status"', '"payment_method"', '"point_used"'],
        "timestamp_str_columns": [],
    },
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
    parquet_path = os.path.join(DATA_DIR, f"{name}.parquet")

    if not os.path.exists(parquet_path):
        raise FileNotFoundError(f"{parquet_path} not found")

    CHUNK_SIZE = 300_000
    pf = pq.ParquetFile(parquet_path)
    strip_cols = [c.strip('"') for c in columns]
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
    TS_PATTERN = r"^(?P<ts>\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:[+-]\d{2}:?\d{2}|Z)?)"

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

        copy_sql = f'COPY "{name}"({cols_str}) FROM STDIN WITH (FORMAT csv, HEADER true' + ", NULL ''" + f', FORCE_NULL ({cols_str}))'
        cur.copy_expert(copy_sql, buf)
        total_rows += batch.num_rows

        if total_rows % (CHUNK_SIZE * 10) == 0 and total_rows > 0:
            print(f"  {name}: {total_rows:,} rows loaded...", flush=True)

    conn.commit()
    print(f"  Loaded {name}: {total_rows:,} rows")


if __name__ == "__main__":
    main()
