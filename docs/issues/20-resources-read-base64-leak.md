# Issue #20: MCP resources/read が画像のbase64データを返却し、AIのコンテキストウィンドウを圧迫する

## 関連タスク

- タスク番号: Jupyter 7.2（画像ファイルの MCP リソース公開）、Jupyter Phase 10（画像ファイル永続化）

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
- [ ] 修正完了

## 症状

Claude Desktop から動作確認をしていたところ、AIが `execute_code` で生成された画像を確認しようとした際に MCP の `resources/read` API を使用し、base64 エンコードされた画像データがレスポンスとして返却された。

AIは「JupyterLabコンテナのファイルシステムはClaude側からは直接アクセスできないため、画像をbase64でエンコードしてClaude側に転送します。」と表示し、大量のbase64データをコンテキストウィンドウに含めてしまう。

Jupyter Phase 10 で `execute_code` のレスポンスからは base64 を排除したが、`resources/read` API が依然として base64 データを返す設計になっているため、AIがそちらを呼び出すことで禁止が回避されてしまっている。

## 再現手順

1. ワークスペースを作成し、セッションを開始する
2. `execute_code` で matplotlib グラフを描画する
3. `resources/list` で画像リソースが公開されていることを確認する
4. `resources/read` で画像リソースを取得する → base64 データが返される

## 再現確認結果

- 再現: できた
- 確認方法: MCP ツール直接呼び出し（`ListMcpResourcesTool` → `ReadMcpResourceTool`）
- エビデンス: `ReadMcpResourceTool` の戻り値に `blob` フィールドとして base64 エンコードされた PNG データが含まれていることを確認

## 期待する動作

AIのコンテキストウィンドウに base64 エンコードされた画像データが含まれないこと。Jupyter Phase 10 の設計意図（コンテキストウィンドウ圧迫の仕組み的回避）が `resources/read` 経路でも守られること。

## 原因（調査後に記入）



## 修正方針（調査後に記入）

### 影響範囲



### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `path/to/file` | （変更内容） |

### テスト計画

