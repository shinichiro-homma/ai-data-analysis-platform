# ドキュメント構成マップ

要件・仕様を変更する際は、以下の依存関係に基づいて関連ファイルを更新すること。

## ファイル一覧と役割

```
CLAUDE.md                           ← 全体概要（コンポーネント表、開発ドキュメントへのリンク）
README.md                           ← GitHub 向け README（概要、セットアップ、ツール一覧）
│
├── .claude/
│   ├── agents/                    ← サブエージェント定義
│   ├── commands/                   ← カスタムコマンド
│   ├── hooks/                      ← フック（PreToolUse / PostToolUse）
│   ├── rules/                      ← 開発ルール
│   └── skills/                     ← 専門知識・実装パターン
│       └── mcp-typescript-server/  ← MCP SDK の Skill
│
├── docs/
│   ├── overview.md                 ← 全体像、アーキテクチャ、ユースケースフロー、データフロー
│   ├── STRUCTURE.md                ← このファイル（ドキュメント構成マップ、更新の依存関係）
│   │
│   ├── requirements/               ← 各コンポーネントの要件定義（正）
│   │   ├── jupyter-server.md
│   │   ├── jupyter-mcp.md
│   │   ├── jupyterlab-ai-sync.md
│   │   ├── document-server.md
│   │   └── document-mcp.md
│   │
│   ├── design/
│   │   └── api-contracts.md        ← REST API の詳細仕様（正）
│   │
│   ├── plan/                       ← 開発タスク一覧、進捗管理
│   │   ├── README.md               ← インデックス（カテゴリ別リンク）
│   │   ├── 01-jupyter.md           ← Jupyter 関連タスク
│   │   ├── 02-document.md          ← Document 関連タスク
│   │   ├── 03-workspace.md         ← Workspace 関連タスク
│   │   └── 04-infrastructure.md    ← Infrastructure 関連タスク
│   │
│   ├── tasks/                      ← タスクごとの詳細な開発計画
│   │   ├── README.md               ← タスク詳細の管理方法
│   │   ├── _template.md            ← テンプレート
│   │   ├── jupyter/                ← Jupyter 関連タスク詳細
│   │   ├── document/               ← Document 関連タスク詳細
│   │   ├── workspace/              ← Workspace 関連タスク詳細
│   │   └── infrastructure/         ← Infrastructure 関連タスク詳細
│   │
│   ├── guides/                     ← 運用ガイド
│   │   └── add-table.md            ← テーブル追加手順
│   │
│   ├── PLAN.md                     ← リダイレクト（→ plan/README.md）
│   ├── MIGRATION_PLAN.md            ← 開発環境移行計画
│   ├── RULES.md                    ← ルール一覧（人間向け説明）
│   └── COMMANDS.md                 ← カスタムコマンド説明
│
├── .mainignore                     ← main ブランチに含めないファイルの一覧
├── scripts/
│   └── promote-to-main.sh         ← dev → main プロモーションスクリプト
│
├── jupyter-server/
│   └── CLAUDE.md                   ← コンポーネント概要
│
├── jupyter-mcp/
│   └── CLAUDE.md                   ← コンポーネント概要、MCPツール一覧
│
├── jupyterlab-ai-sync/
│   └── CLAUDE.md                   ← コンポーネント概要、受信イベント一覧
│
├── document-server/
│   └── CLAUDE.md                   ← コンポーネント概要、API一覧
│
└── document-mcp/
    └── CLAUDE.md                   ← コンポーネント概要、MCPツール一覧
```

## 更新の依存関係

以下の表に従って、変更内容に応じた関連ファイルを**すべて**更新すること。

| 変更内容 | 更新が必要なファイル |
|----------|---------------------|
| **MCPツールの追加・変更** | `docs/requirements/{component}-mcp.md` → `{component}-mcp/CLAUDE.md` → `README.md`（ツール一覧） → `docs/plan/`（タスク追加） |
| **REST APIの追加・変更** | `docs/requirements/{component}-server.md` → `docs/design/api-contracts.md` → `{component}-server/CLAUDE.md` → `docs/plan/` |
| **アーキテクチャ変更** | `docs/overview.md` → 影響する全 `requirements/*.md` → 影響する全 `*/CLAUDE.md` → `CLAUDE.md`（該当すれば） → `README.md` |
| **データフロー変更** | `docs/overview.md` → 関連する `requirements/*.md` |
| **新コンポーネント追加** | `CLAUDE.md` → `README.md` → `docs/overview.md` → `docs/requirements/{new}.md`（新規作成） → `{new}/CLAUDE.md`（新規作成） → `docs/plan/` |
| **要件定義リンクの追加・削除** | `CLAUDE.md`（要件定義セクション） + `README.md`（要件定義セクション） |
| **開発タスクの追加・変更** | `docs/plan/` 内の該当ファイル |

## 各ファイルの更新ポイント

### CLAUDE.md
- コンポーネント表（名前、概要、ポート）
- 新コンポーネント追加時に更新

### README.md
- コンポーネント表（名前、概要、ポート）
- **MCPツール一覧**（ツール名＋1行概要、詳細は要件定義へ参照）
- アーキテクチャ図（`docs/overview.md` へのリンク参照のみ）
- セットアップ手順
- MCPツール追加・変更、コンポーネント追加時に更新

### docs/overview.md
- アーキテクチャ図
- ユースケースフロー
- コンポーネント詳細（責務のみ。技術スタック・ツール一覧は含めない）
- データフロー
- 非機能要件

### docs/requirements/*.md（正）
- 機能要件（F1, F2, ...）
- 非機能要件
- ツール/API定義（入出力スキーマ）
- 技術スタック
- 受け入れ条件

### docs/design/api-contracts.md（正）
- エンドポイント一覧
- リクエスト/レスポンス形式
- エラーコード

### */CLAUDE.md（各コンポーネント）
- コンポーネント概要
- コマンド一覧
- 環境変数
- ツール/API一覧（簡易版、要件定義への参照リンク付き）

### docs/plan/（開発プラン）
- `README.md` — インデックス（カテゴリ別リンク）
- `01-jupyter.md` — Jupyter 関連タスク一覧・ステータス
- `02-document.md` — Document 関連タスク一覧・ステータス
- `03-workspace.md` — Workspace 関連タスク一覧・ステータス
- `04-infrastructure.md` — Infrastructure 関連タスク一覧・ステータス

## Single Source of Truth（正）の定義

| 情報 | 正 | サマリー/参照を置いてよい場所 |
|------|-----|------------------------------|
| MCPツール定義（入出力スキーマ） | `docs/requirements/*-mcp.md` | `*/CLAUDE.md`（名前リスト）、`README.md`（名前＋1行概要） |
| REST API仕様 | `docs/design/api-contracts.md` | `*/CLAUDE.md`（エンドポイント名リスト） |
| 技術スタック | `docs/requirements/*.md` | `*/CLAUDE.md`（簡易版） |
| 開発コマンド | `*/CLAUDE.md` | — |
| 環境変数 | `*/CLAUDE.md` | `docs/requirements/*.md`（要件としての説明のみ） |
| アーキテクチャ図 | `docs/overview.md` | `README.md`（リンク参照のみ） |
| コンポーネント表 | `CLAUDE.md` | `README.md`（同一内容を意図的に二重管理: 外部公開用） |
