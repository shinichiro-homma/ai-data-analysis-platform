# AI Data Analysis Platform

生成AIによるデータ分析を可能にするプラットフォーム。Jupyter環境での分析実行とデータカタログ管理を、MCPサーバー経由で生成AIに提供します。

## 主な特徴

- **ワークスペース分離** - チャット（AI会話）ごとに独立した作業空間を提供。ファイルやカーネルが他のチャットと干渉しない
- **AIリアルタイム同期** - AIがノートブックを編集している様子をブラウザでリアルタイムに確認可能。AI編集中はノートブックを自動ロック
- **データカタログ・用語集・既存ロジック** - 2層構造（インデックス＋詳細）のMCPツールで、AIが業務知識を効率的に参照しながら分析を実行

## アーキテクチャ

詳細なアーキテクチャ図は [プロジェクト全体像](docs/overview.md) を参照。

## コンポーネント

| 名前 | 概要 | ポート |
|------|------|--------|
| jupyter-server | JupyterLabベースの分析実行環境 | 8888 |
| jupyter-mcp | Jupyter操作用MCPサーバー | 3001 |
| jupyterlab-ai-sync | AIリアルタイム同期JupyterLab拡張 | - (jupyter-serverに同梱) |
| document-server | データカタログ・用語集・ロジック管理API | 3002 |
| document-mcp | カタログ・用語集・ロジック参照用MCPサーバー | 3003 |

## セットアップ

### 必要条件

- Docker & Docker Compose
- Node.js 20+

### 1. リポジトリのクローン

```bash
git clone https://github.com/shinichiro-homma/ai-data-analysis-platform.git
cd ai-data-analysis-platform
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集し、以下の値を設定してください:

```env
# PostgreSQL
POSTGRES_PASSWORD=your-postgres-password-here  # 任意のパスワードに変更

# Jupyter Server
JUPYTER_TOKEN=your-secret-token-here           # 任意のトークンに変更
```

### 3. サービスの起動

```bash
docker-compose up -d
```

以下のサービスが起動します:

| サービス | URL | 説明 |
|---------|-----|------|
| PostgreSQL | localhost:5432 | 分析対象データベース（CSVデータを初期ロード） |
| jupyter-server | http://localhost:8888 | JupyterLab（ブラウザでアクセス） |
| document-server | http://localhost:3002 | カタログ・用語集・ロジックAPI |

JupyterLab にはブラウザで `http://localhost:8888?token=<JUPYTER_TOKEN>` でアクセスできます。

### 4. MCPサーバーのビルド

MCPサーバー（jupyter-mcp, document-mcp）は Claude Desktop からローカルプロセスとして起動されるため、docker-compose には含まれません。事前にビルドしておきます。

```bash
# jupyter-mcp
cd jupyter-mcp && npm install && cd ..
scripts/rebuild-mcp.sh jupyter-mcp

# document-mcp
cd document-mcp && npm install && cd ..
scripts/rebuild-mcp.sh document-mcp
```

### 5. Claude Desktop への接続設定

Claude Desktop の設定ファイル（`claude_desktop_config.json`）に以下を追加してください:

```json
{
  "mcpServers": {
    "jupyter-mcp": {
      "command": "node",
      "args": ["<absolute-path-to>/jupyter-mcp/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "<your-jupyter-token>"
      }
    },
    "document-mcp": {
      "command": "node",
      "args": ["<absolute-path-to>/document-mcp/dist/index.js"],
      "env": {
        "DOCUMENT_SERVER_URL": "http://localhost:3002"
      }
    }
  }
}
```

`<absolute-path-to>` と `<your-jupyter-token>` は実際の値に置き換えてください。

## MCPツール一覧

### jupyter-mcp（分析実行制御）

| ツール | 概要 |
|--------|------|
| `workspace_create` | ワークスペース作成 |
| `workspace_list` | ワークスペース一覧 |
| `workspace_update` | ワークスペース更新 |
| `workspace_summarize` | 検証レポート用テンプレート取得 |
| `session_create` | セッション作成 |
| `session_list` | セッション一覧 |
| `session_connect` | 既存セッション接続 |
| `session_delete` | セッション終了 |
| `execute_code` | Pythonコード実行 |
| `get_variables` | 変数一覧取得 |
| `get_dataframe_info` | DataFrame情報取得 |
| `notebook_create` | ノートブック作成 |
| `notebook_add_cell` | セル追加 |
| `notebook_list_cells` | セル一覧取得 |
| `notebook_edit_cell` | セル編集 |
| `notebook_delete_cell` | セル削除 |
| `notebook_execute_cell` | セル再実行 |
| `file_list` | ファイル一覧取得 |
| `execute_sql` | SQL実行・結果確認 |
| `export_sql` | SQLデータエクスポート |
| `ai_edit_start` | AI編集モード開始 |
| `ai_edit_end` | AI編集モード終了 |
| `get_image` | 画像取得 |

> 詳細は [docs/requirements/jupyter-mcp.md](docs/requirements/jupyter-mcp.md) を参照。

### document-mcp（カタログ・用語集・ロジック参照）

| ツール | 概要 |
|--------|------|
| `get_table_index` | テーブルインデックス取得 |
| `get_table_detail` | テーブル詳細取得 |
| `get_term_index` | 用語インデックス取得 |
| `get_term_detail` | 用語詳細取得 |
| `get_logic_index` | ロジックインデックス取得 |
| `get_logic_detail` | ロジックメタ情報取得 |
| `get_logic_code` | ロジックコード取得 |

> 詳細は [docs/requirements/document-mcp.md](docs/requirements/document-mcp.md) を参照。

## 使い方

### 基本的なフロー

1. **ワークスペース作成** - AIが `workspace_create` で専用の作業空間を確保
2. **セッション作成** - `session_create` でPythonカーネルを起動
3. **データカタログ参照** - `get_table_index` → `get_table_detail` でテーブル構造を把握
4. **分析実行** - `execute_code` でデータ取得・加工・可視化
5. **結果確認** - AIが結果を解釈して回答。グラフはブラウザのJupyterLabで確認

### ブラウザでのリアルタイム確認

JupyterLab をブラウザで開いた状態で AI に分析を依頼すると、AIの操作（セル追加、コード実行、結果表示）がリアルタイムに反映されます。AI編集中はノートブックが自動ロックされ、完了後にユーザーが自由に編集できます。

## ドキュメント

| ドキュメント | 内容 |
|-------------|------|
| [プロジェクト全体像](docs/overview.md) | アーキテクチャ、ユースケースフロー、データフロー |
| [ドキュメント構成マップ](docs/STRUCTURE.md) | ファイル一覧と役割、更新の依存関係 |
| [API仕様](docs/design/api-contracts.md) | REST API の詳細仕様 |

### 要件定義

- [jupyter-server](docs/requirements/jupyter-server.md)
- [jupyter-mcp](docs/requirements/jupyter-mcp.md)
- [jupyterlab-ai-sync](docs/requirements/jupyterlab-ai-sync.md)
- [document-server](docs/requirements/document-server.md)
- [document-mcp](docs/requirements/document-mcp.md)

## 開発

### ブランチモデル

```
main (公開・リリース済み)
 └── dev (統合・検証用)
      └── feature/xxx ← dev から切る
```

- 日常の開発は `dev` ブランチで行う
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する
- 開発計画・進捗管理などの dev-only ドキュメントは `dev` ブランチにのみ存在する

### テストの実行

```bash
# jupyter-mcp のテスト
scripts/test.sh jupyter-mcp

# document-mcp のテスト
scripts/test.sh document-mcp

# document-server のテスト
scripts/test.sh document-server

# E2Eテスト（docker-compose が起動している状態で）
scripts/test.sh --integration

# コード変更後はリビルド付きで実行
scripts/test.sh --rebuild jupyter-mcp
```

### 個別開発

```bash
# MCPサーバーの開発（ホットリロード）
cd jupyter-mcp && npm run dev
cd document-mcp && npm run dev

# document-server の開発
cd document-server && uvicorn src.main:app --reload --port 3002
```

## ライセンス

MIT
