# Claude Desktop 接続動作確認ガイド

Claude Desktop から jupyter-mcp に接続した後の動作確認手順とトラブルシューティングをまとめたドキュメントです。

## セットアップ手順

接続設定（`claude_desktop_config.json` の編集方法・WSL 向け起動パターン・必要な環境変数）は [プロジェクト README の「5. Claude Desktop への接続設定」](../../README.md#5-claude-desktop-への接続設定) を参照してください。

接続後、Claude Desktop のチャット画面下部にハンマーアイコンが表示され、クリックすると `jupyter-mcp` のツールが一覧できれば接続成功です。提供ツールの一覧は [`docs/requirements/jupyter-mcp.md`](../../docs/requirements/jupyter-mcp.md) を参照してください。

## 動作確認テスト

Claude Desktop で以下のプロンプトを順に送信し、AI がツールを自律的に選択・実行することを確認します。

### テスト 1: セッション作成とコード実行

```
新しい分析セッションを作成して、Pythonで「Hello from Claude Desktop」と表示してください。
```

確認ポイント:

- `session_create` が呼ばれる
- `execute_code` が呼ばれる
- 実行結果に「Hello from Claude Desktop」が含まれる

### テスト 2: データ分析

```
pandasでサンプルデータを作成して分析してください。
- 100行のデータ（日付、カテゴリ、金額）
- カテゴリ別の集計
- 基本統計量の確認
```

確認ポイント:

- `execute_code` でデータ生成・集計コードが実行される
- `get_variables` / `get_dataframe_info` で DataFrame 構造が確認される

### テスト 3: グラフ描画と画像認識

```
先ほどのデータを使って、カテゴリ別の金額を棒グラフで可視化してください。グラフの内容を説明してください。
```

確認ポイント:

- `execute_code` で matplotlib 描画コードが実行される
- `get_image` 経由で画像データが取得される
- Claude が画像の内容を自然言語で説明する

### テスト 4: エラーハンドリング

```
1/0 を計算するPythonコードを実行してください。
```

確認ポイント:

- `execute_code` の結果に `ZeroDivisionError` が含まれる
- Claude がエラー内容を説明する

### テスト 5: セッション管理

```
現在のセッション一覧を確認して、不要なセッションがあれば削除してください。
```

確認ポイント:

- `session_list` で一覧取得
- `session_delete` で削除
- 再度 `session_list` で削除結果を確認

## トラブルシューティング

### ツールが表示されない

- Claude Desktop の `Settings → Developer → MCP servers` にエラーが出ていないか確認する
- `claude_desktop_config.json` の JSON 構文エラー（カンマ・クォート）を確認する
- `args` のパスが絶対パスか、対象ファイルが実在するか確認する
- Claude Desktop を**完全終了**してから再起動する（プロセスが常駐していると設定が再読み込みされない）

### ツールはあるが認証に失敗する（401）

- `.env` の `JUPYTER_TOKEN` と、`claude_desktop_config.json` の `env.JUPYTER_TOKEN` が**完全一致**していることを確認する
- `.env` の値を変更した場合は `scripts/rebuild.sh jupyter-server` で反映する
- ブラウザで `http://localhost:8888/?token=<.env の JUPYTER_TOKEN>` にアクセスしてログインできるか確認する

### コード実行がタイムアウトする

- `docker compose ps` で jupyter-server が `Up (healthy)` であることを確認する
- `docker compose logs jupyter-server` でエラーが出ていないか確認する
- jupyter-mcp を手動起動してログを見る場合は `cd jupyter-mcp && npm run dev`

### 画像が認識されない

- `execute_code` の結果に `images` 配列（`resource_uri` 付き）が含まれているか確認する
- `matplotlib` のバックエンドが `Agg` 等の非対話モードになっているか確認する
- 必要に応じて `get_image` ツールで明示的に画像を取得させる

## 参考リンク

- [プロジェクト README](../../README.md)
- [jupyter-mcp 要件定義](../../docs/requirements/jupyter-mcp.md)
- [MCP Inspector テスト手順書](./inspector-test-guide.md)
