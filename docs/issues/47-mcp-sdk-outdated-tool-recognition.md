# Issue #47: MCP SDK旧バージョン(0.5.0)によりClaude Desktopでツールが認識されない

## 関連タスク

- タスク番号: なし（MCP SDKアップグレードは未計画）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

production 環境を起動し、Claude Desktop 経由でデータ操作を行おうとしたところ:

1. Claude Desktop が `get_table_detail` ツール（document-mcp）をロードできないと応答する
2. Jupyter 環境（jupyter-mcp のツール群）も認識されていない（「Jupyter やクエリエディタで実行できる環境はありますか？」と聞かれた）

## 再現手順

1. `scripts/switch-env.sh production` で production 環境に切り替える
2. `docker-compose up -d` で Docker 環境を起動する
3. Claude Desktop で新しい会話を開始する
4. データカタログの参照や SQL の実行を依頼する

## 再現確認結果

### MCP サーバーの動作確認

- **手動起動テスト**: 両サーバーとも正常に起動し、initialize ハンドシェイク・tools/list ともに正常応答
  - document-mcp: 7 ツール返却
  - jupyter-mcp: 17 ツール返却

### Claude Desktop ログ分析

- `~/Library/Logs/Claude/mcp-server-document-mcp.log` にて tools/list は成功
- `~/Library/Logs/Claude/mcp-server-jupyter-mcp.log` にて tools/list は成功
- 以前のセッション（14:37〜14:38）では `get_table_detail` 等のツール呼び出しも成功

### プロトコルバージョン不一致

| 項目 | バージョン |
|------|-----------|
| Claude Desktop 要求 | `protocolVersion: "2025-11-25"` |
| MCP サーバー応答 | `protocolVersion: "2024-11-05"` |
| インストール済み SDK | `@modelcontextprotocol/sdk@0.5.0` |
| 最新 SDK | `@modelcontextprotocol/sdk@1.27.1` |

### 副次的な発見

- `document-mcp/src/utils/response-formatter.ts` の `createErrorResponse` に `isError: true` が含まれていない（Issue #46 で jupyter-mcp のみ修正済み）

## 期待する動作

Claude Desktop から document-mcp の全7ツールおよび jupyter-mcp の全17ツールが利用可能であること。

## 原因

### チャットログ分析による再評価

Claude Desktop のチャットログを分析した結果、当初の推定（SDKプロトコル不一致が全原因）とは異なる症状が判明した。

**一部のツールは正常に動作している:**
- document-mcp: 7ツール中6ツールが正常動作（`get_table_detail` のみ `tool_search` で発見不可）
- jupyter-mcp: `workspace_list`, `get_image` は動作するが、`execute_code`, `session_create` 等は発見不可

**これはプロトコルレベルの完全な拒否ではない。** プロトコルネゴシエーション自体は成功しており、`tools/list` も正常に返却されている。

### 原因1（主因）: ツール説明文が tool_search のセマンティック検索に不適合

Claude Desktop はツール数が多い場合、遅延ロード（deferred tools）を使用し、`tool_search`（セマンティック検索）でツールを発見する。以下のツールの description が検索にヒットしにくい構造になっている。

**document-mcp `get_table_detail`（143文字）:**
- 括弧内の内部用語（`key_type/key_types`, `domain`, `additional`）がベクトル空間を汚染
- 同じ detail パターンの `get_term_detail`(79文字), `get_logic_detail`(103文字) はシンプルで発見可能

**jupyter-mcp `execute_code`（112文字）:**
- 他ツールへの参照や動作条件の説明が多い
- ユーザーが使う「データ分析」「集計」「可視化」のような語がない

**jupyter-mcp `session_create`（68文字）:**
- 「セッション」は技術用語で、ユーザーの「分析を始めたい」等の語とセマンティック距離が大きい

### 原因2（副因）: MCP SDK バージョンの旧式化

`@modelcontextprotocol/sdk@0.5.0` は MCP プロトコル `2024-11-05` のみサポート。Claude Desktop は `2025-11-25` を要求しており、フォールバックで接続はできているが、新プロトコルの機能（ツール提示方式の改善等）が利用できていない可能性がある。

### 原因3（副因）: document-mcp の isError 欠落

`document-mcp/src/utils/response-formatter.ts:36-55` の `createErrorResponse` に `isError: true` が含まれていない（Issue #46 で jupyter-mcp のみ修正済み）。

## 修正方針

ツール説明文の改善のみを実施し、Claude Desktop で問題が解決するか確認する。SDK アップグレード（副因）は本修正の効果を確認した後に別途検討する。

### アプローチ

ツール description を `tool_search` のセマンティック検索で発見しやすい構造に改善する。原則: 冒頭の1文を「ユーザー視点で何ができるか」に絞り、実装詳細は簡潔にまとめる。

### 影響範囲

**コンポーネント**: jupyter-mcp, document-mcp の両方

**要件定義・API仕様の変更**: 不要（ツール説明文は要件定義に含まれない）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `document-mcp/src/tools/index.ts` | `get_table_detail` の description を簡潔化（括弧内の内部用語を除去） |
| `jupyter-mcp/src/tools/index.ts` | `execute_code`, `session_create` 等の description をユーザー視点の語彙に改善。他ツールも見直し |

### 未実施（効果確認後に別途検討）

- MCP SDK アップグレード（0.5.0 → 最新）
- document-mcp `createErrorResponse` の `isError: true` 追加

### テスト計画

1. **単体テスト**: `scripts/test.sh jupyter-mcp` および `scripts/test.sh document-mcp` で全単体テストがパスすることを確認
2. **MCP サーバーリビルド**: `scripts/rebuild-mcp.sh jupyter-mcp` および `scripts/rebuild-mcp.sh document-mcp` でビルド成功を確認
3. **Claude Desktop 確認**: Claude Desktop から全ツール（jupyter-mcp: 17ツール、document-mcp: 7ツール）が `tool_search` で発見・実行可能であることを確認
