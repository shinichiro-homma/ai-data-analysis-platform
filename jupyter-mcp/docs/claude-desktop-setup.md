# Claude Desktop 接続設定ガイド

このドキュメントでは、Claude Desktop から jupyter-mcp に接続する方法を説明します。

## 前提条件

以下の環境が準備されていることを確認してください：

- **Node.js**: v18 以上がインストールされていること
- **Claude Desktop**: 最新版がインストールされていること
- **jupyter-server**: Docker で起動していること
- **jupyter-mcp**: ビルド済みであること

## セットアップ手順

### 1. jupyter-server の起動

```bash
cd jupyter-server
docker-compose up -d
```

起動確認:
```bash
docker-compose ps
# jupyter-server が Up 状態であることを確認
```

### 2. jupyter-mcp のビルド

```bash
cd jupyter-mcp
npm install
npm run build
```

ビルド成果物の確認:
```bash
ls dist/index.js
# ファイルが存在することを確認
```

### 3. Claude Desktop の設定ファイル編集

Claude Desktop の設定ファイルを編集します。

**ファイルパス（macOS）:**
```
~/Library/Application Support/Claude/claude_desktop_config.json
```

**ファイルパス（Windows）:**
```
%APPDATA%\Claude\claude_desktop_config.json
```

**設定内容:**

```json
{
  "mcpServers": {
    "jupyter-mcp": {
      "command": "node",
      "args": ["{プロジェクトの絶対パス}/jupyter-mcp/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "test-token-123"
      }
    }
  }
}
```

**重要:**
- `{プロジェクトの絶対パス}` を実際のパスに置き換えてください
  - 例: `/Users/yourname/projects/ai-data-analysis-platform`
- 既存の設定がある場合は、`mcpServers` オブジェクトに追記してください
- `JUPYTER_TOKEN` の値は `jupyter-server/docker-compose.yml` の `JUPYTER_TOKEN` 環境変数と一致させてください

### 4. Claude Desktop の再起動

設定ファイルを変更したら、Claude Desktop を完全に再起動してください。

**macOS:**
```
1. Cmd + Q でアプリを終了
2. Claude Desktop を再度起動
```

**Windows:**
```
1. Alt + F4 でアプリを終了
2. Claude Desktop を再度起動
```

### 5. 接続確認

Claude Desktop のチャット画面で以下を確認してください：

1. **ツールアイコンの表示**
   - 画面下部の入力欄付近にハンマーアイコンが表示される

2. **ツール一覧の確認**
   - ハンマーアイコンをクリック
   - `jupyter-mcp` の 11 個のツールが一覧に表示される
     - `notebook_create`
     - `notebook_add_cell`
     - `session_create`
     - `session_list`
     - `session_delete`
     - `session_connect`
     - `execute_code`
     - `get_variables`
     - `get_dataframe_info`
     - `file_list`
     - `get_image_resource`

## 動作確認テスト

Claude Desktop で以下のプロンプトを送信して、正しく動作することを確認してください。

### テスト 1: 基本的なコード実行

```
新しい分析セッションを作成して、Pythonで「Hello from Claude Desktop」と表示してください。
```

**期待される動作:**
- Claude が `session_create` を自動で呼び出す
- Claude が `execute_code` でコードを実行する
- 「Hello from Claude Desktop」が表示される

### テスト 2: データ分析

```
pandasでサンプルデータを作成して分析してください。
- 100行のデータ（日付、カテゴリ、金額）
- カテゴリ別の集計
- 基本統計量の確認
```

**期待される動作:**
- Claude がデータ生成コードを実行する
- Claude が `get_variables` や `get_dataframe_info` でデータを確認する
- 分析結果が表示される

### テスト 3: グラフ描画

```
先ほどのデータを使って、カテゴリ別の金額を棒グラフで可視化してください。
```

**期待される動作:**
- Claude が matplotlib でグラフを描画する
- Claude が `get_image_resource` で画像を取得する
- グラフが表示され、Claude が内容を説明する

## トラブルシューティング

### ツールが表示されない

**原因:**
- 設定ファイルのパスが間違っている
- 設定ファイルの JSON 形式が不正
- Claude Desktop の再起動が不完全

**対処法:**
1. 設定ファイルのパスを確認する
   ```bash
   # macOS
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

   # Windows
   type %APPDATA%\Claude\claude_desktop_config.json
   ```

2. JSON の構文エラーがないか確認する
   - 不要なカンマがないか
   - クォートの閉じ忘れがないか

3. Claude Desktop を完全に終了してから再起動する
   - macOS: アクティビティモニタで Claude プロセスが残っていないか確認
   - Windows: タスクマネージャーで Claude プロセスが残っていないか確認

### ツールはあるが実行できない

**原因:**
- jupyter-server が起動していない
- 環境変数が間違っている

**対処法:**
1. jupyter-server の起動を確認する
   ```bash
   docker ps
   # jupyter-server が Up 状態か確認
   ```

2. jupyter-server のログを確認する
   ```bash
   cd jupyter-server
   docker-compose logs
   ```

3. 設定ファイルの環境変数を確認する
   - `JUPYTER_SERVER_URL`: http://localhost:8888
   - `JUPYTER_TOKEN`: docker-compose.yml と一致しているか

### コード実行がタイムアウトする

**原因:**
- カーネルが起動していない
- ネットワークの問題

**対処法:**
1. ブラウザで JupyterLab にアクセスして動作を確認する
   ```
   http://localhost:8888/?token=test-token-123
   ```

2. jupyter-mcp のログを確認する（開発モード時）
   ```bash
   cd jupyter-mcp
   npm run dev
   ```

### 画像が表示されない

**原因:**
- matplotlib のバックエンド設定
- 画像リソースの URI が正しくない

**対処法:**
1. コード実行時に `plt.show()` ではなく `plt.gcf()` を使う
2. execute_code の結果に `images` 配列が含まれているか確認
3. `get_image_resource` で画像を明示的に取得する

## 高度な設定

### 複数の MCP サーバーと共存

既存の MCP サーバー設定がある場合の例:

```json
{
  "mcpServers": {
    "existing-server": {
      "command": "...",
      "args": ["..."]
    },
    "jupyter-mcp": {
      "command": "node",
      "args": ["/path/to/jupyter-mcp/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:8888",
        "JUPYTER_TOKEN": "test-token-123"
      }
    }
  }
}
```

### カスタムポート

jupyter-server が別のポートで起動している場合:

```json
{
  "mcpServers": {
    "jupyter-mcp": {
      "command": "node",
      "args": ["/path/to/jupyter-mcp/dist/index.js"],
      "env": {
        "JUPYTER_SERVER_URL": "http://localhost:9999",
        "JUPYTER_TOKEN": "your-custom-token"
      }
    }
  }
}
```

## 参考リンク

- [MCP Server 開発ガイド](../../.claude/skills/mcp-typescript-server/SKILL.md)
- [jupyter-mcp 要件定義](../../docs/requirements/jupyter-mcp.md)
- [プロジェクト全体像](../../docs/overview.md)
