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
- [uv](https://docs.astral.sh/uv/getting-started/installation/) 0.4+（Python 依存管理）

### 1. リポジトリのクローン

```bash
git clone https://github.com/shinichiro-homma/ai-data-analysis-platform.git
cd ai-data-analysis-platform
```

### 2. 初回セットアップ

```bash
bash scripts/bootstrap.sh
```

Python 依存関係の同期（`uv sync`）・git 設定・`.env` の自動コピーを一括で行います。
uv が未インストールの場合はスクリプトがインストール手順を案内します。
`.env` はコピー後に `POSTGRES_PASSWORD` / `JUPYTER_TOKEN` を任意の値に変更してください。

### 3. サービスの起動

初回起動時はデータ環境切り替えスクリプト経由で起動します。PostgreSQL のボリューム初期化・起動待機・CSV データのロードまでを一括で実施します:

```bash
scripts/switch-env.sh sample
```

以下のサービスが起動します:

| サービス | URL | 説明 |
|---------|-----|------|
| PostgreSQL | localhost:5432 | 分析対象データベース（CSVデータを初期ロード） |
| jupyter-server | http://localhost:8888 | JupyterLab（ブラウザでアクセス） |
| document-server | http://localhost:3002 | カタログ・用語集・ロジックAPI |

JupyterLab にはブラウザで `http://localhost:8888?token=<JUPYTER_TOKEN>` でアクセスできます。

> **`docker-compose up -d` を直接使わない理由**: 素の `docker-compose up -d` はテーブル作成までしか行わず、データロードは走りません（ロードはホスト側 Python から `scripts/lib/common.sh:run_load_data` 経由で実行される設計のため）。初回は必ず `scripts/switch-env.sh sample` を使ってください。`production` 環境に切り替える場合は引数を `production` に変更します。既に起動済みのサービスを停止・再起動するだけなら `docker compose stop` / `docker compose start` で構いません。

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

Claude Desktop の設定ファイル `claude_desktop_config.json` を開きます（Claude Desktop メニュー → `Settings` → `Developer` → `Edit Config`）。設定ファイルのパスは OS により異なります:

| OS | パス |
|----|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows / WSL | `%LOCALAPPDATA%\Packages\Claude_<PACKAGE_ID>\LocalCache\Roaming\Claude\claude_desktop_config.json` |

> Windows 版 Claude Desktop は MSIX パッケージとして配布されているため、config ファイルは `%APPDATA%\Claude\` ではなく `%LOCALAPPDATA%\Packages\Claude_<PACKAGE_ID>\LocalCache\Roaming\Claude\` 配下に配置されます。`<PACKAGE_ID>` は実環境で `%LOCALAPPDATA%\Packages\` 配下を `Claude_*` で検索して特定してください。迷ったら Claude Desktop メニューの `Settings → Developer → Edit Config` が正しいファイルを開いてくれます。

`mcpServers` に以下のエントリを追加してください:

```json
{
  "mcpServers": {
    "jupyter-mcp": {
      "command": "node",
      "args": ["<absolute-path-to>/jupyter-mcp/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "<JUPYTER_TOKEN>"
      }
    },
    "document-mcp": {
      "command": "node",
      "args": ["<absolute-path-to>/document-mcp/dist/index.js"],
      "env": {
        "DOCUMENT_SERVER_URL": "http://localhost:3002",
        "DOCUMENT_SERVER_TOKEN": "<DOCUMENT_SERVER_TOKEN>"
      }
    }
  }
}
```

置換ポイント:

- `<absolute-path-to>` — プロジェクトの絶対パス（以下「WSL の場合」節では `<PROJECT_PATH>` と表記）
- `<JUPYTER_TOKEN>` / `<DOCUMENT_SERVER_TOKEN>` — プロジェクト直下の `.env` の同名変数と**完全一致**させる（不一致だと 401 になる）

**WSL の場合**: Claude Desktop は Windows プロセスのため、Linux パスと Linux 側 `node` を直接指定すると失敗します。`wsl.exe` 経由で起動しますが、**`node` の絶対パスを指定する必要があります**（理由は下記）。

事前に WSL で以下を実行し、node とプロジェクトの絶対パスを控えておきます:

```bash
which node                 # → <NODE_PATH>（例: /home/<user>/.nvm/versions/node/v24.14.1/bin/node）
pwd                        # プロジェクトルートで実行 → <PROJECT_PATH>
```

控えた値を以下の `<NODE_PATH>` / `<PROJECT_PATH>` に埋め込んでください。**`env` に加えて `WSLENV` を必ず併記する**のがポイントです（理由は下記）:

```json
{
  "mcpServers": {
    "jupyter-mcp": {
      "command": "wsl.exe",
      "args": [
        "<NODE_PATH>",
        "<PROJECT_PATH>/jupyter-mcp/dist/index.js"
      ],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "<JUPYTER_TOKEN>",
        "WSLENV": "JUPYTER_SERVER_URL:JUPYTER_TOKEN"
      }
    },
    "document-mcp": {
      "command": "wsl.exe",
      "args": [
        "<NODE_PATH>",
        "<PROJECT_PATH>/document-mcp/dist/index.js"
      ],
      "env": {
        "DOCUMENT_SERVER_URL": "http://localhost:3002",
        "DOCUMENT_SERVER_TOKEN": "<DOCUMENT_SERVER_TOKEN>",
        "WSLENV": "DOCUMENT_SERVER_URL:DOCUMENT_SERVER_TOKEN"
      }
    }
  }
}
```

> **なぜ `node` の絶対パスが必要か**: nvm でインストールした node は `~/.bashrc` 内で PATH に追加されます。`wsl.exe node ...` は非対話シェルで `.bashrc` を読まず、`wsl.exe bash -lc "node ..."` でもログインシェルは `.bash_profile` / `.profile` しか読まないため、いずれも `node: command not found` になります。確実に動かすには `which node` で得た絶対パスを直接指定してください。
>
> **node を更新したら再設定**: nvm で node バージョンを上げるとパスの `v<version>` 部分が変わります。本 config の `<NODE_PATH>` も追従して更新してください。
>
> **なぜ `WSLENV` が必要か**: `wsl.exe` は Claude Desktop が `env` で渡した Windows 側環境変数を、既定では Linux 側の子プロセスに転送しません。転送したい変数名をコロン区切りで `WSLENV` に列挙することで初めて Linux 側の node プロセスに渡ります。`WSLENV` を忘れると `DOCUMENT_SERVER_TOKEN が未設定` や jupyter 側の `HTTP 403` といった症状が出ます。

保存後、Claude Desktop を完全終了（macOS: Cmd+Q / Windows: タスクトレイから終了）してから再起動し、ハンマーアイコンに両サーバーのツールが表示されれば成功です。

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
| `notebook_reorder_cell` | セル並び替え |
| `notebook_execute_batch` | セル一括実行 |
| `notebook_merge_cells` | セル結合 |
| `notebook_split_cell` | セル分割 |
| `notebook_change_cell_type` | セルタイプ変更 |
| `notebook_copy_cell` | セルコピー |
| `notebook_clear_outputs` | 出力クリア |
| `kernel_restart` | カーネル再起動 |
| `file_list` | ファイル一覧取得 |
| `file_read` | ファイル読み取り |
| `data_preview` | データプレビュー |
| `execute_sql` | SQL実行・結果確認 |
| `export_sql` | SQLデータエクスポート |
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

## システムプロンプトテンプレート

本プラットフォーム向けに、AI の分析ワークフローを整えるためのシステムプロンプトのテンプレートを [`system-prompt-templates/`](system-prompt-templates/) に同梱しています。Claude Desktop のプロジェクト指示（Project Instructions）や API 利用時の system プロンプトに貼り付けて利用してください。

| ファイル | 言語 |
|---------|------|
| [`analysis-policy.md`](system-prompt-templates/analysis-policy.md) | English |
| [`analysis-policy.ja.md`](system-prompt-templates/analysis-policy.ja.md) | 日本語 |

テンプレートに含まれる主なポリシー:

- **計画 → 1ステップ実行 → 報告 → 待機** の原則（計画なしにツールを連鎖させない）
- **ツール呼び出しの順序**（`workspace_create` → `session_create` → `notebook_create` → 分析）
- **データ準備フェーズ**（用語カタログ・テーブル・既存ロジックの確認を SQL 作成前に必ず行う）
- **`export_sql` / `execute_sql` / `execute_code` の使い分け**（生データ取得 vs. 中身確認 vs. 集計・可視化）
- **外部ファイル・Unicode 正規化・Excel 読み込み**の落とし穴回避
- **メモリ管理**（各ステップ実行前のチェックと 80% 超時の対処）

利用は任意ですが、AI に一貫した分析手順を踏ませたい場合は適用を推奨します。プロジェクト固有のルールを追記してカスタマイズしても構いません。

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

### ブラウザ操作・UI 検証

JupyterLab の UI 挙動確認やバグ再現は [`@playwright/cli`](https://www.npmjs.com/package/@playwright/cli) の利用を推奨する。セットアップと使い方は [docs/guides/browser-automation.md](docs/guides/browser-automation.md) を参照。

## ライセンス

MIT
