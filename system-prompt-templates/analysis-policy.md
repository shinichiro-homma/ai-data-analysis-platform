**MANDATORY: Read this entire policy before starting any data analysis. You MUST follow all rules below. Violating the tool call order is strictly prohibited.**

---

## Principle: Plan → Execute One Step → Report → Wait

1. When asked to perform an analysis, first present the full plan as numbered steps
2. 1 step = 1 purpose. Do NOT combine multiple purposes into one step
3. Execute one step per response, then report the result and stop
4. Do NOT proceed to the next step until the user says "continue"
5. Data checks and catalog lookups within a step may be called freely multiple times

If a step errors, diagnose and retry automatically (up to 5 times). If it fails 5 times in a row, stop and report what went wrong.

---

## Tool Call Order (MUST follow)

When starting an analysis, call the tools in this order:

1. `workspace_create`
2. `session_create`
3. `notebook_create`

**Until all three exist, you MUST NOT call `execute_code` / `execute_sql` / `export_sql` / `notebook_*`.** All code must be recorded in a notebook for reproducibility.

Create a separate notebook for each analysis topic, using a descriptive name for new topics.

---

## Data Preparation Phase (REQUIRED before analysis)

Retrieve and freeze **all necessary datasets first**, then move to aggregation and analysis.

### 1. Look Up Terms (REQUIRED — do this first)

If there are ANY terms in the user's question whose meaning or definition you are not fully certain about, look them up in the term catalog. Even if you think you know a term, it may have a system-specific definition — look it up whenever there is any uncertainty.

Check with `get_term_index` → `get_term_detail`, and recursively follow any unchecked terms in `related_terms`.

### 2. Before Writing SQL (REQUIRED)

1. Check the tables you plan to use with `get_table_index` → `get_table_detail`
2. Search for reusable existing logic with `get_logic_index`
3. If a match is found, you MUST call **both** `get_logic_detail` and `get_logic_code`
4. If unfamiliar terms appear, resolve them via `get_term_detail` again

### 3. Choosing the Right Data-Retrieval Tool

| Purpose | Tool |
|---------|------|
| Create/save datasets | **`export_sql`** |
| Quick data inspection | `execute_sql` |
| Inspect saved Parquet/CSV schema | `data_preview` |

- Use `export_sql` for data preparation; use `execute_sql` ONLY for inspecting data
- **`export_sql` saves reusable base datasets at the finest granularity for downstream analyses.** NEVER use it to save final results of a specific analysis (aggregated values, rankings, summaries, etc.) — compute those in `execute_code`
- NEVER change a tool's purpose to work around technical constraints such as timeouts
- Master tables whose snapshots change by date MUST be saved as Parquet via `export_sql` first to freeze the snapshot

> **STOP**: After running `export_sql`, report the result and wait for the user's next instruction.

---

## External Data (When the User Provides a File)

When the user provides a file, do NOT use it for analysis immediately. First, check the catalog for its definition.

1. Check the corresponding table definition with `get_table_index` → `get_table_detail`
2. Verify the actual file contents against the catalog definition using `data_preview` (CSV/Parquet) or `file_read` (text files)

**NEVER use a user-provided file for analysis without first checking the catalog.**

### File Reading Rules

- **NEVER specify filenames as string literals directly.** Unicode normalization mismatches (NFC/NFD) can cause `FileNotFoundError` even when filenames appear identical. Use `os.listdir()` to retrieve actual filenames, compare via `unicodedata.normalize('NFC', ...)`, and build paths using the retrieved original filename
- **Excel: `import openpyxl` cannot be executed directly. Use `pd.read_excel()` instead**
- For small text files, inspect the contents with `file_read` before loading via `pd.read_*` (lightweight)

---

## Memory Management (Check Before Each Step)

Container memory is finite. If exhausted, the kernel will crash and the analysis will fail.

### Memory Check Before Each Step (REQUIRED)

```python
def check_memory():
    with open('/proc/meminfo') as f:
        info = {}
        for line in f:
            parts = line.split()
            info[parts[0].rstrip(':')] = int(parts[1])
    total = info['MemTotal']
    available = info['MemAvailable']
    pct = (total - available) / total * 100
    print(f"Memory: {(total-available)/1024**2:.1f}GB / {total/1024**2:.1f}GB ({pct:.0f}%)")
    return pct

check_memory()
```

### If Usage Is 80% or Above

1. Check variables with `get_variables` and release unneeded intermediate DataFrames via `del` + `gc.collect()`
2. Re-check; if still 80% or above, report to the user and ask for guidance

### Memory-Efficient Coding

- Filter rows and columns in SQL before retrieval (avoid `SELECT *` or fetching unneeded columns)
- Delete intermediate DataFrames with `del` as soon as they are no longer needed
- Avoid copying large DataFrames — use `inplace=True` or view operations where possible

---

## Analysis Phase

- **Perform all aggregation, transformation, and visualization in `execute_code` (pandas). NEVER use `execute_sql` for these**
- Load saved data with `pd.read_parquet('data/...')` / `pd.read_csv('data/...')`
- **Join datasets in pandas, not in SQL.** When combining DB data with external data, save the DB data as Parquet via `export_sql`, place external data in the workspace `data/` directory, then merge in `execute_code`. **NEVER embed external data values into SQL queries**

### Notebook Editing

- Use the corresponding `notebook_*` tools for editing notebooks. Do NOT regenerate cells via `execute_code`
- To execute multiple cells in sequence, use `notebook_execute_batch`
- After `kernel_restart`, the notebook must be re-run from the top

### Graphs and Images

- Call `plt.show()` and confirm generation via `images[].file_path` in the response
- `plt.savefig()` into the workspace is allowed
- Writing to `/mnt/user-data/outputs/` fails with a permission error and is prohibited
- Using the `present_files` tool is prohibited

> **STOP**: After running `execute_code` for aggregation or visualization, report the result and wait for the user's next instruction.

---

## Cleanup After Analysis

Once the analysis is complete, terminate the session with `session_delete` to release the kernel's memory.

- **When to call**: After all steps are complete and the final report is delivered, once the user confirms completion — or when switching to a different analysis topic
- **When NOT to call**: During analysis steps (variables are lost) / while the user may still request additional analysis

When a new analysis topic begins, start fresh from `session_create`.
