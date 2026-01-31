# 開発ルール一覧

Claude Code で適用されるルールの一覧。

ルールファイルは `.claude/rules/` に配置され、`paths` で指定されたファイルに自動適用される。

---

## ルールファイル一覧

| ファイル | 適用範囲 | 内容 |
|----------|----------|------|
| `general.md` | 全ファイル | 開発フロー、コミット規約、禁止事項 |
| `typescript.md` | jupyter-mcp, document-mcp | TypeScript規約、MCP実装ルール |
| `python.md` | document-server, jupyter-server | Python規約、FastAPI実装ルール |
| `security.md` | 全コンポーネント | セキュリティ要件 |
| `documentation.md` | docs/, CLAUDE.md | ドキュメント更新手順、記述スタイル |
| `testing.md` | tests/, *.test.ts, test_*.py | テスト規約、命名規則 |

---

## 各ルールの概要

### general.md（全体）

**適用:** `**/*`

- 開発フロー（PLAN.md確認 → 要件確認 → 実装 → ステータス更新）
- コミットメッセージ形式（`feat:`, `fix:`, `docs:` 等）
- 禁止事項（要件未確認での実装、複数タスク同時進行等）

### typescript.md（TypeScript）

**適用:** `jupyter-mcp/**/*`, `document-mcp/**/*`

- `any` 禁止、型定義必須
- async/await 使用
- MCP ツールの description/inputSchema 記述方法
- エラーハンドリング方法

### python.md（Python）

**適用:** `document-server/**/*`, `jupyter-server/**/*`

- Black/isort でフォーマット
- 型ヒント必須
- Pydantic モデル使用
- FastAPI ルーター構成、レスポンス形式

### documentation.md（ドキュメント）

**適用:** `docs/**/*.md`, `**/CLAUDE.md`

- 要件変更時の影響範囲洗い出し手順
- ドキュメント更新順序
- 整合性確認チェックリスト
- 変更履歴の記録

### testing.md（テスト）

**適用:** `**/tests/**/*`, `**/*.test.ts`, `**/test_*.py` 等

- Arrange-Act-Assert パターン
- モックの使い方
- エッジケース（正常系、異常系、境界値）
- **セキュリティテスト**（認証、入力検証、機密情報、タイムアウト）
- テスト実行コマンド

### security.md（セキュリティ）

**適用:** 全コンポーネント（`jupyter-server/**/*`, `jupyter-mcp/**/*`, `document-server/**/*`, `document-mcp/**/*`）

- 認証・認可（トークン検証、権限チェック）
- 入力検証（サニタイズ、SQLインジェクション対策、パストラバーサル対策）
- 機密情報の管理（環境変数、ログ出力禁止、レスポンスマスク）
- コード実行の安全性（タイムアウト、リソース制限）
- 依存関係の管理（脆弱性チェック）
- エラーハンドリング（詳細情報の隠蔽）

---

## ルールの仕組み

Claude Code は作業中のファイルパスに基づいて、該当するルールを自動的に読み込む。

**例:**
- `jupyter-mcp/src/tools/session.ts` を編集中
  → `general.md` + `typescript.md` が適用
- `docs/requirements/jupyter-server.md` を編集中
  → `general.md` + `documentation.md` が適用
- `document-server/tests/test_api.py` を編集中
  → `general.md` + `python.md` + `testing.md` が適用

---

## ルールの追加・変更

新しいルールを追加する場合：

1. `.claude/rules/` に新しい `.md` ファイルを作成
2. ファイル冒頭に `paths` を YAML 形式で記述
3. ルールの内容を記述
4. このファイル（`docs/RULES.md`）に追加

```markdown
---
paths:
  - "src/api/**/*"
---

# API ルール

（ルールの内容）
```
