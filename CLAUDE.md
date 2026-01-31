# AI Data Analysis Platform

生成AIによるデータ分析を可能にするプラットフォーム。Jupyter環境での分析実行とデータカタログ管理を、MCPサーバー経由で生成AIに提供する。

## 開発ドキュメント

- [開発プラン](docs/PLAN.md) - タスク一覧と進捗管理
- [開発ルール](docs/RULES.md) - 開発時のルール
- [カスタムコマンド](docs/COMMANDS.md) - Claude Code で使えるコマンド一覧

## コンポーネント

| 名前 | 概要 | ポート |
|------|------|--------|
| jupyter-server | JupyterLabベースの分析実行環境 | 8888 |
| jupyter-mcp | Jupyter操作用MCPサーバー | 3001 |
| document-server | データカタログ管理API | 3002 |
| document-mcp | カタログ参照用MCPサーバー | 3003 |

## 開発コマンド

```bash
# 全体起動
docker-compose up -d

# 個別起動（各ディレクトリ内で）
npm run dev        # MCPサーバー
jupyter lab        # jupyter-server
```

---

## ドキュメント構成マップ

要件・仕様を変更する際は、以下の依存関係に基づいて関連ファイルを更新すること。

### ファイル一覧と役割

```
CLAUDE.md                           ← このファイル（全体概要）
│
├── .claude/
│   ├── commands/                   ← カスタムコマンド
│   ├── rules/                      ← 開発ルール
│   └── skills/                     ← 専門知識・実装パターン
│       └── mcp-typescript-server/  ← MCP SDK の Skill
│
├── docs/
│   ├── overview.md                 ← 全体像、アーキテクチャ、データフロー
│   │
│   ├── requirements/               ← 各コンポーネントの要件定義
│   │   ├── jupyter-server.md
│   │   ├── jupyter-mcp.md
│   │   ├── document-server.md
│   │   └── document-mcp.md
│   │
│   ├── design/
│   │   └── api-contracts.md        ← REST API の詳細仕様
│   │
│   ├── tasks/                      ← タスクごとの詳細な開発計画
│   │   ├── README.md               ← タスク詳細の管理方法
│   │   ├── _template.md            ← テンプレート
│   │   └── {番号}-{名前}.md        ← 各タスクの計画
│   │
│   ├── PLAN.md                     ← 開発タスク一覧、進捗管理
│   ├── RULES.md                    ← ルール一覧（人間向け説明）
│   └── COMMANDS.md                 ← カスタムコマンド説明
│
├── jupyter-server/
│   └── CLAUDE.md                   ← コンポーネント概要
│
├── jupyter-mcp/
│   └── CLAUDE.md                   ← コンポーネント概要、MCPツール一覧
│
├── document-server/
│   └── CLAUDE.md                   ← コンポーネント概要、API一覧
│
└── document-mcp/
    └── CLAUDE.md                   ← コンポーネント概要、MCPツール一覧
```

### 更新の依存関係

以下の表に従って、変更内容に応じた関連ファイルを**すべて**更新すること。

| 変更内容 | 更新が必要なファイル |
|----------|---------------------|
| **MCPツールの追加・変更** | `docs/requirements/{component}-mcp.md` → `docs/overview.md`（ツール一覧表） → `{component}-mcp/CLAUDE.md` → `docs/PLAN.md`（タスク追加） |
| **REST APIの追加・変更** | `docs/requirements/{component}-server.md` → `docs/design/api-contracts.md` → `docs/overview.md`（該当すれば） → `{component}-server/CLAUDE.md` → `docs/PLAN.md` |
| **アーキテクチャ変更** | `docs/overview.md` → 影響する全 `requirements/*.md` → 影響する全 `*/CLAUDE.md` → `CLAUDE.md`（このファイル） |
| **データフロー変更** | `docs/overview.md` → 関連する `requirements/*.md` |
| **新コンポーネント追加** | `CLAUDE.md` → `docs/overview.md` → `docs/requirements/{new}.md`（新規作成） → `{new}/CLAUDE.md`（新規作成） → `docs/PLAN.md` |
| **開発タスクの追加・変更** | `docs/PLAN.md` のみ |

### 各ファイルの更新ポイント

#### CLAUDE.md（このファイル）
- コンポーネント表（名前、概要、ポート）
- 新コンポーネント追加時に更新

#### docs/overview.md
- アーキテクチャ図
- ユースケースフロー
- コンポーネント詳細（責務、技術スタック）
- **MCPツール一覧表**
- **API一覧表**
- データフロー

#### docs/requirements/*.md
- 機能要件（F1, F2, ...）
- 非機能要件
- ツール/API定義（入出力スキーマ）
- 受け入れ条件

#### docs/design/api-contracts.md
- エンドポイント一覧
- リクエスト/レスポンス形式
- エラーコード

#### */CLAUDE.md（各コンポーネント）
- コンポーネント概要
- ディレクトリ構成
- コマンド一覧
- 環境変数
- ツール/API一覧（簡易版）

#### docs/PLAN.md
- タスク一覧
- ステータス
- 変更履歴

---

## ドキュメント参照

### 要件定義

- [jupyter-server](docs/requirements/jupyter-server.md)
- [jupyter-mcp](docs/requirements/jupyter-mcp.md)
- [document-server](docs/requirements/document-server.md)
- [document-mcp](docs/requirements/document-mcp.md)

### 設計

- [プロジェクト全体像](docs/overview.md)
- [API仕様](docs/design/api-contracts.md)
