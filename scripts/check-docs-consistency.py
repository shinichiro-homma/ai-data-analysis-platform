#!/usr/bin/env python3
"""ドキュメントとコードの整合性を機械検証する。

検証内容（docs/STRUCTURE.md「CI による整合性検証」が仕様の正）:

1. MCP ツール名の同期
   {mcp}/src/tools/index.ts に登録されたツール名と、
   docs/requirements/{mcp}.md の「## ツール一覧」表の一致を双方向で検証する。

2. REST エンドポイントの同期
   - jupyter-server: extensions/custom_api/handlers.py の get_handlers() のルートと
     docs/design/api-contracts.md の jupyter-server 表を照合する。
     Tornado のルート表には HTTP メソッド情報がないため、パス構造レベルで照合する
     （パスパラメータは正規化して比較。メソッド列は照合対象外）。
   - document-server: src/routers/*.py と src/main.py の FastAPI デコレータと
     api-contracts.md の document-server 表を「メソッド + パス」で照合する。

3. Markdown 相対リンク切れ
   docs/ 配下・リポジトリルート・各コンポーネントの CLAUDE.md を検査する。
   archive/ 配下は履歴記録（移動により相対リンクが古い前提）のため対象外。

依存: Python 標準ライブラリのみ（CI では uv 不要で `python` 直接実行可）。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MCP_COMPONENTS = ["jupyter-mcp", "document-mcp"]

errors: list[str] = []


def fail(msg: str) -> None:
    errors.append(msg)


# ──────────────────────────────────────────────
# 1. MCP ツール名の同期
# ──────────────────────────────────────────────


def extract_registered_tools(index_ts: Path) -> set[str]:
    """src/tools/index.ts のツール定義から name: '...' を抽出する。"""
    text = index_ts.read_text(encoding="utf-8")
    return set(re.findall(r"^\s*name: '([a-z0-9_]+)'", text, re.MULTILINE))


def extract_tool_table(requirements_md: Path) -> set[str]:
    """「## ツール一覧」セクションの表からバッククォート付きツール名を抽出する。"""
    text = requirements_md.read_text(encoding="utf-8")
    lines = text.splitlines()
    tools: set[str] = set()
    in_section = False
    for line in lines:
        if re.match(r"^##\s+ツール一覧\s*$", line):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section and line.startswith("|"):
            m = re.match(r"^\|\s*`([a-z0-9_]+)`\s*\|", line)
            if m:
                tools.add(m.group(1))
    if not in_section:
        fail(f"{requirements_md.relative_to(ROOT)}: 「## ツール一覧」セクションが見つからない")
    return tools


def check_mcp_tools() -> None:
    for component in MCP_COMPONENTS:
        index_ts = ROOT / component / "src" / "tools" / "index.ts"
        requirements_md = ROOT / "docs" / "requirements" / f"{component}.md"
        if not index_ts.exists():
            fail(f"{component}: {index_ts.relative_to(ROOT)} が存在しない")
            continue
        code_tools = extract_registered_tools(index_ts)
        doc_tools = extract_tool_table(requirements_md)
        if not code_tools:
            fail(
                f"{component}: コードからツール名を抽出できない（登録形式が変わった場合はこのスクリプトを更新すること）"
            )
            continue
        for tool in sorted(code_tools - doc_tools):
            fail(
                f"{component}: ツール `{tool}` がコードに存在するが "
                f"{requirements_md.relative_to(ROOT)} のツール一覧表にない"
            )
        for tool in sorted(doc_tools - code_tools):
            fail(
                f"{component}: ツール `{tool}` が {requirements_md.relative_to(ROOT)} "
                f"のツール一覧表にあるがコードに存在しない"
            )


# ──────────────────────────────────────────────
# 2. REST エンドポイントの同期
# ──────────────────────────────────────────────

API_CONTRACTS = ROOT / "docs" / "design" / "api-contracts.md"


def normalize_doc_path(path: str) -> str:
    """ドキュメント上のパス（{name} 形式）をパラメータ名非依存に正規化する。"""
    return re.sub(r"\{[^}]*\}", "{}", path.strip()).rstrip("/") or "/"


def normalize_tornado_path(path: str) -> str:
    """Tornado ルートの正規表現グループを {} に正規化する。"""
    return re.sub(r"\([^)]*\)", "{}", path.strip()).rstrip("/") or "/"


def extract_contract_table(section: str) -> list[tuple[str, str]]:
    """api-contracts.md の指定セクションから (メソッド, パス) を抽出する。"""
    text = API_CONTRACTS.read_text(encoding="utf-8")
    lines = text.splitlines()
    rows: list[tuple[str, str]] = []
    in_section = False
    for line in lines:
        if re.match(rf"^##\s+{re.escape(section)}\s*$", line):
            in_section = True
            continue
        if in_section and line.startswith("## "):
            break
        if in_section and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) >= 2 and re.fullmatch(r"(GET|POST|PUT|PATCH|DELETE|WS|WebSocket)", cells[0], re.IGNORECASE):
                rows.append((cells[0].upper(), cells[1].strip("`")))
    if not in_section:
        fail(f"{API_CONTRACTS.relative_to(ROOT)}: 「## {section}」セクションが見つからない")
    return rows


def check_jupyter_server_endpoints() -> None:
    handlers_py = ROOT / "jupyter-server" / "extensions" / "custom_api" / "handlers.py"
    if not handlers_py.exists():
        fail(f"{handlers_py.relative_to(ROOT)} が存在しない")
        return
    text = handlers_py.read_text(encoding="utf-8")
    m = re.search(r"def get_handlers\(.*?return \[(.*?)^\s*\]", text, re.DOTALL | re.MULTILINE)
    if not m:
        fail(
            "jupyter-server: get_handlers() のルート表を抽出できない（形式が変わった場合はこのスクリプトを更新すること）"
        )
        return
    code_paths = {normalize_tornado_path(p) for p in re.findall(r'f"\{base_url\}(/[^"]*)"', m.group(1))}
    doc_paths = {normalize_doc_path(p) for _, p in extract_contract_table("jupyter-server")}
    if not doc_paths:
        return
    for p in sorted(code_paths - doc_paths):
        fail(f"jupyter-server: エンドポイント {p} がコードに存在するが api-contracts.md の表にない")
    for p in sorted(doc_paths - code_paths):
        fail(f"jupyter-server: エンドポイント {p} が api-contracts.md の表にあるがコードに存在しない")


def check_document_server_endpoints() -> None:
    src = ROOT / "document-server" / "src"
    if not src.exists():
        fail(f"{src.relative_to(ROOT)} が存在しない")
        return
    code_endpoints: set[tuple[str, str]] = set()
    py_files = sorted((src / "routers").glob("*.py")) + [src / "main.py"]
    for py in py_files:
        if not py.exists():
            continue
        text = py.read_text(encoding="utf-8")
        prefix_m = re.search(r'APIRouter\([^)]*prefix="([^"]+)"', text, re.DOTALL)
        prefix = prefix_m.group(1) if prefix_m else ""
        for method, path in re.findall(r'@(?:router|app)\.(get|post|put|patch|delete)\(\s*"([^"]*)"', text):
            full = (prefix + path) if path != "/" else (prefix or "/")
            code_endpoints.add((method.upper(), normalize_doc_path(full)))
    doc_endpoints = {(method, normalize_doc_path(path)) for method, path in extract_contract_table("document-server")}
    if not doc_endpoints:
        return
    for method, p in sorted(code_endpoints - doc_endpoints):
        fail(f"document-server: {method} {p} がコードに存在するが api-contracts.md の表にない")
    for method, p in sorted(doc_endpoints - code_endpoints):
        fail(f"document-server: {method} {p} が api-contracts.md の表にあるがコードに存在しない")


# ──────────────────────────────────────────────
# 3. Markdown 相対リンク切れ
# ──────────────────────────────────────────────


def strip_code(text: str) -> str:
    """フェンスコードブロックとインラインコードを除去する（リンク誤検出防止）。"""
    text = re.sub(r"```.*?```", "", text, flags=re.DOTALL)
    return re.sub(r"`[^`\n]*`", "", text)


def link_check_targets() -> list[Path]:
    targets = list(ROOT.glob("*.md"))
    targets += [p for p in ROOT.glob("docs/**/*.md") if "archive" not in p.parts]
    targets += list(ROOT.glob("*/CLAUDE.md"))
    return sorted(set(targets))


def check_markdown_links() -> None:
    for md in link_check_targets():
        text = strip_code(md.read_text(encoding="utf-8"))
        for target in re.findall(r"\]\(([^)]+)\)", text):
            target = target.split()[0].split("#")[0].strip()
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (ROOT / target.lstrip("/")) if target.startswith("/") else (md.parent / target)
            if not resolved.exists():
                fail(f"{md.relative_to(ROOT)}: リンク切れ → {target}")


# ──────────────────────────────────────────────


def main() -> int:
    check_mcp_tools()
    check_jupyter_server_endpoints()
    check_document_server_endpoints()
    check_markdown_links()
    if errors:
        print(f"NG: ドキュメント整合性エラー {len(errors)} 件\n")
        for e in errors:
            print(f"  - {e}")
        print(
            "\nコードが正（docs/STRUCTURE.md）: コード側の変更が正しい場合は"
            "ドキュメントの一覧表を更新すること。表形式の仕様は docs/STRUCTURE.md の"
            "「CI による整合性検証」を参照。"
        )
        return 1
    print("OK: ドキュメント整合性チェック（MCPツール名・エンドポイント・リンク）に問題なし")
    return 0


if __name__ == "__main__":
    sys.exit(main())
