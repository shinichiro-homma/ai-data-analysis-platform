# document-mcp

生成AIがデータカタログ、用語集、既存ロジックを参照するためのMCPサーバー。

## 概要

- document-server のREST APIをラップ
- 3つのコンテキスト情報を提供（用語集・データカタログ・既存ロジック）
- 2層構造（インデックス＋詳細）でコンテキストを効率的に使用
  - 第1層: インデックス取得（軽量）
  - 第2層: 詳細取得（必要な項目のみ）

## 技術スタック

[docs/requirements/document-mcp.md](../docs/requirements/document-mcp.md) を参照。

## コマンド

```bash
npm install        # 依存関係インストール
npm run dev        # 開発（ホットリロード）
npm run build      # ビルド
npm start          # 本番起動
npm test           # テスト
npm run typecheck  # 型チェック
```

## 環境変数

| 変数 | 説明 |
|------|------|
| `DOCUMENT_SERVER_URL` | document-serverのURL |
| `LOG_LEVEL` | ログレベル |

## MCPツール一覧

`get_table_index`, `get_table_detail`, `get_term_index`, `get_term_detail`, `get_logic_index`, `get_logic_detail`, `get_logic_code`

> 各ツールの詳細は [docs/requirements/document-mcp.md](../docs/requirements/document-mcp.md) を参照。
> 一括取得の上限や戻り値の構造は `src/utils/validation.ts`・`src/utils/response-formatter.ts` を参照。

## 要件定義

詳細は [docs/requirements/document-mcp.md](../docs/requirements/document-mcp.md) を参照。

## 依存関係

- document-server が起動していること
