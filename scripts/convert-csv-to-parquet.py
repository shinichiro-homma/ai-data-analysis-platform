#!/usr/bin/env python3
"""Convert CSV files to Parquet format.

Reads CSV files from postgres/data/csv/{env}/ and writes Parquet files
to postgres/data/{env}/. Existing Parquet files are skipped unless --force
is specified.
"""

import os
import re
import sys

try:
    import pyarrow.csv as pa_csv
    import pyarrow.parquet as pq
except ImportError:
    print(
        "ERROR: pyarrow is required.\n  Install with: pip install pyarrow\n  Or: pip install pyarrow[snappy]",
        file=sys.stderr,
    )
    sys.exit(1)


def usage() -> None:
    print(
        f"Usage: {sys.argv[0]} [--force] <ENV>\n"
        "\n"
        "Convert CSV files in postgres/data/csv/<ENV>/ to Parquet format\n"
        "in postgres/data/<ENV>/.\n"
        "\n"
        "Options:\n"
        "  --force    Re-convert even if Parquet file already exists\n"
        "  -h, --help Show this help message\n"
        "\n"
        "Examples:\n"
        f"  {sys.argv[0]} sample\n"
        f"  {sys.argv[0]} --force production",
        file=sys.stderr,
    )


def parse_args(argv: list[str]) -> tuple[str, bool]:
    """Parse command-line arguments and return (env_name, force)."""
    force = False
    env_name = None

    for arg in argv:
        if arg in ("-h", "--help"):
            usage()
            sys.exit(0)
        elif arg == "--force":
            force = True
        elif arg.startswith("-"):
            print(f"Error: unknown option '{arg}'", file=sys.stderr)
            usage()
            sys.exit(1)
        elif env_name is None:
            env_name = arg
        else:
            print(f"Error: unexpected argument '{arg}'", file=sys.stderr)
            usage()
            sys.exit(1)

    if env_name is None:
        print("Error: environment is required", file=sys.stderr)
        usage()
        sys.exit(1)

    if not re.fullmatch(r"[A-Za-z0-9_-]+", env_name):
        print(f"Error: environment name contains invalid characters: '{env_name}'", file=sys.stderr)
        sys.exit(1)

    return env_name, force


def convert_csv_to_parquet(csv_path: str, parquet_path: str) -> tuple[int, int]:
    """Convert a single CSV file to Parquet with snappy compression."""
    read_options = pa_csv.ReadOptions(encoding="utf-8-sig")
    table = pa_csv.read_csv(csv_path, read_options=read_options)
    pq.write_table(table, parquet_path, compression="snappy")
    return table.num_rows, table.num_columns


def format_size(size_bytes: int) -> str:
    """Format file size in human-readable form."""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    else:
        return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"


def print_summary(
    converted: list[str],
    skipped: list[str],
    failed: list[tuple[str, str]],
    total_csv_size: int,
    total_parquet_size: int,
) -> None:
    """Print conversion summary."""
    print("")
    print("Summary:")
    print(f"  Converted: {len(converted)}")
    print(f"  Skipped:   {len(skipped)}")
    print(f"  Failed:    {len(failed)}")
    if total_csv_size > 0:
        size_pct = total_parquet_size / total_csv_size * 100
        print(f"  Size:      {format_size(total_csv_size)} → {format_size(total_parquet_size)} ({size_pct:.0f}%)")


def main() -> None:
    env_name, force = parse_args(sys.argv[1:])

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    csv_dir = os.path.realpath(os.path.join(project_root, "postgres", "data", "csv", env_name))
    parquet_dir = os.path.realpath(os.path.join(project_root, "postgres", "data", env_name))

    expected_prefix = os.path.realpath(os.path.join(project_root, "postgres", "data"))
    if not csv_dir.startswith(expected_prefix + os.sep) or not parquet_dir.startswith(expected_prefix + os.sep):
        print(f"Error: invalid environment '{env_name}'", file=sys.stderr)
        sys.exit(1)

    if not os.path.isdir(csv_dir):
        rel_csv_dir = os.path.relpath(csv_dir, project_root)
        print(f"Error: CSV directory not found: {rel_csv_dir}", file=sys.stderr)
        sys.exit(1)

    csv_files = sorted(f for f in os.listdir(csv_dir) if f.endswith(".csv"))
    if not csv_files:
        rel_csv_dir = os.path.relpath(csv_dir, project_root)
        print(f"No CSV files found in {rel_csv_dir}")
        sys.exit(0)

    os.makedirs(parquet_dir, exist_ok=True)

    converted: list[str] = []
    skipped: list[str] = []
    failed: list[tuple[str, str]] = []
    total_csv_size = 0
    total_parquet_size = 0

    print(f"Converting CSV files in {os.path.relpath(csv_dir, project_root)}/")
    print(f"Output directory: {os.path.relpath(parquet_dir, project_root)}/")
    print("")

    for csv_file in csv_files:
        base_name = os.path.splitext(csv_file)[0]
        csv_path = os.path.join(csv_dir, csv_file)
        parquet_file = f"{base_name}.parquet"
        parquet_path = os.path.join(parquet_dir, parquet_file)

        csv_size = os.path.getsize(csv_path)

        if os.path.exists(parquet_path) and not force:
            skipped.append(csv_file)
            print(f"  SKIP  {csv_file} (Parquet already exists)")
            continue

        try:
            rows, cols = convert_csv_to_parquet(csv_path, parquet_path)
            parquet_size = os.path.getsize(parquet_path)
            total_csv_size += csv_size
            total_parquet_size += parquet_size
            converted.append(csv_file)
            size_pct = (parquet_size / csv_size * 100) if csv_size > 0 else 0
            print(
                f"  OK    {csv_file} → {parquet_file}"
                f"  ({rows} rows, {cols} cols,"
                f" {format_size(csv_size)} → {format_size(parquet_size)},"
                f" {size_pct:.0f}%)"
            )
        except Exception as e:
            if os.path.exists(parquet_path):
                os.remove(parquet_path)
            failed.append((csv_file, str(e)))
            print(f"  FAIL  {csv_file}: [{type(e).__name__}] {e}", file=sys.stderr)

    print_summary(converted, skipped, failed, total_csv_size, total_parquet_size)

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
