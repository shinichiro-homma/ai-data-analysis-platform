# プロジェクト全体像

## 目的

生成AIが自然言語の指示に基づいてデータ分析を実行できる環境を提供する。

ユーザーは「売上データを分析して傾向を教えて」のような指示を出すだけで、AIが適切なデータを特定し、分析コードを生成・実行し、結果を返却する。

## アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────────────┐
│                        生成AI (Claude等)                         │
└─────────────────────────────────────────────────────────────────┘
                    │                           │
                    │ MCP Protocol              │ MCP Protocol
                    ▼                           ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│       jupyter-mcp           │   │       document-mcp          │
│   (TypeScript MCP Server)   │   │   (TypeScript MCP Server)   │
└─────────────────────────────┘   └─────────────────────────────┘
                    │                           │
                    │ REST API                  │ REST API
                    ▼                           ▼
┌─────────────────────────────┐   ┌─────────────────────────────┐
│      jupyter-server         │   │     document-server         │
│   (JupyterLab + Kernel)     │   │  (YAMLカタログ読み込み)      │
└─────────────────────────────┘   └─────────────────────────────┘
                    │                           │
                    ▼                           ▼
              既存データベース               カタログファイル
            (PostgreSQL等)                  (YAML/JSON)
```

## 典型的なユースケースフロー

### データ分析リクエスト

```
ユーザー: 「先月の売上データを分析して、地域別の傾向を教えて」

【第1段階：カタログ概要の把握】
    │
    ▼
生成AI: document-mcp の list_table_summaries で全テーブル概要を取得
    │   → 軽量な概要情報でどのテーブルを使うか判断
    │   → "sales_transactions", "stores" が必要と判断
    │
【第2段階：必要なテーブルの詳細取得】
    │
    ▼
生成AI: document-mcp の get_table_details で詳細を取得
    │   → カラム定義、サンプルデータ、関連テーブルを確認
    │   → JOIN条件を把握
    │
【第3段階：分析コード生成・実行】
    │
    ▼
生成AI: get_connection_info で接続コードを取得
    │
    ▼
生成AI: jupyter-mcp の session_create でセッション作成
    │
    ▼
生成AI: execute_code でデータ取得・分析コードを実行
    │   → グラフ描画 + 数値データ出力
    │
    ▼
生成AI: 画像リソースを取得して傾向を確認
    │   → 数値データで具体的な値を把握
    │
    ▼
生成AI: 実行結果を解釈してユーザーに回答
```

### データカタログの準備（PoC）

```
管理者: YAMLファイルでカタログを作成
    │
    ├── _datasources.yaml（DB接続情報）
    ├── sales.yaml（売上関連テーブル）
    └── products.yaml（商品関連テーブル）
    │
    ▼
document-server: 起動時にYAMLを読み込み、検索APIを提供
```

## コンポーネント詳細

### jupyter-server

JupyterLabをベースとした分析実行環境。

**責務:**
- Pythonカーネルの管理
- ノートブックの永続化
- コード実行と結果の返却

**技術スタック:**
- JupyterLab
- Python 3.11+
- 分析ライブラリ（pandas, numpy, matplotlib等）

### jupyter-mcp

生成AIがJupyter環境を操作するためのMCPサーバー。

**責務:**
- セッション管理（カーネル起動/停止）
- コード実行リクエストの中継
- 実行結果・画像の返却

**技術スタック:**
- TypeScript
- MCP TypeScript SDK
- Jupyter Server REST API クライアント

**提供するMCPツール:**

| ツール | 説明 |
|--------|------|
| `session_create` | 分析セッションを作成 |
| `session_list` | セッション一覧を取得 |
| `session_delete` | セッションを終了 |
| `execute_code` | Pythonコードを実行 |
| `get_variables` | 定義済み変数一覧を取得 |
| `get_dataframe_info` | DataFrameの詳細情報を取得 |
| `notebook_create` | ノートブックを作成 |
| `notebook_add_cell` | セルを追加 |
| `file_list` | ファイル一覧を取得 |
| `get_image_resource` | 生成された画像を取得 |

**MCPリソース:**
- `jupyter://sessions/{session_id}/images/{image_id}` - 実行結果の画像

### document-server

事前作成されたデータカタログを読み込み、検索APIを提供するサーバー。

**責務:**
- YAMLカタログファイルの読み込み
- テーブル検索API
- DB接続情報の提供

**技術スタック:**
- Python 3.11+ / FastAPI
- PyYAML
- インメモリ検索

**主要エンドポイント:**

| エンドポイント | 説明 |
|---------------|------|
| `GET /api/v1/tables` | テーブル一覧（概要） |
| `GET /api/v1/tables/{name}` | テーブル詳細 |
| `GET /api/v1/search?q=...` | キーワード検索 |
| `GET /api/v1/tables/{name}/connection` | 接続情報 |
| `POST /api/v1/admin/reload` | カタログ再読み込み |

### document-mcp

生成AIがデータカタログを参照するためのMCPサーバー。
2段階アプローチでコンテキストを効率的に使用する。

**責務:**
- カタログ概要の提供（第1段階）
- テーブル詳細の提供（第2段階）
- 接続情報の提供

**技術スタック:**
- TypeScript
- MCP TypeScript SDK

**提供するMCPツール:**

| ツール | 段階 | 説明 |
|--------|------|------|
| `list_table_summaries` | 第1段階 | 全テーブルの概要を取得（軽量） |
| `get_tags` | 第1段階 | タグ一覧を取得 |
| `get_table_details` | 第2段階 | 指定テーブルの全情報を取得 |
| `get_connection_info` | 第2段階 | DB接続コードを取得 |

**2段階アプローチの意図:**
1. 第1段階: 全テーブルの概要（カラム情報なし）で全体を把握
2. 第2段階: 必要なテーブルのみ詳細を取得してコンテキストを節約

## データフロー

### 分析実行時のデータフロー

```
【カタログ参照】
1. AI → document-mcp: list_table_summaries()
2. document-mcp → document-server: GET /api/v1/tables
3. document-server → document-mcp: 全テーブル概要
4. document-mcp → AI: テーブル概要リスト

5. AI: 使用するテーブルを判断

6. AI → document-mcp: get_table_details(["sales_transactions", "stores"])
7. document-mcp → document-server: GET /api/v1/tables/{name} (複数回)
8. document-server → document-mcp: テーブル詳細
9. document-mcp → AI: カラム定義、サンプルデータ、関連テーブル

【分析実行】
10. AI: 分析コード生成

11. AI → jupyter-mcp: session_create()
12. jupyter-mcp → jupyter-server: POST /api/kernels
13. jupyter-server → jupyter-mcp: カーネルID
14. jupyter-mcp → AI: セッションID

15. AI → jupyter-mcp: execute_code(session_id, code)
16. jupyter-mcp → jupyter-server: POST /api/kernels/{id}/execute
17. jupyter-server: コード実行（グラフ生成）
18. jupyter-server → jupyter-mcp: 実行結果 + 画像
19. jupyter-mcp → AI: 結果 + 画像リソースURI

20. AI → jupyter-mcp: get_image_resource(resource_uri)
21. jupyter-mcp → AI: 画像データ（base64）

22. AI: 画像を認識して傾向を把握、数値データと合わせて回答
```

## 画像認識とデータ取得の使い分け

生成AIの画像認識には特性があるため、グラフと数値データを併用する。

| 目的 | 方法 |
|------|------|
| 全体的なトレンド確認 | グラフを見る |
| 異常値・外れ値の発見 | グラフを見る |
| カテゴリ間の大小比較 | グラフを見る |
| 特定時点の正確な値 | 数値データを出力 |
| 集計値（合計、平均等） | 数値データを出力 |

**推奨パターン:**
```python
# グラフで傾向を可視化
plt.plot(df['date'], df['sales'])
plt.show()

# 具体的な数値も出力（AIが正確に読める）
print(f"最大: {df['sales'].max():,.0f}")
print(f"最小: {df['sales'].min():,.0f}")
print(df[['date', 'sales']].to_string())
```

## 非機能要件

### セキュリティ
- jupyter-serverは信頼されたネットワーク内でのみ公開
- DB接続情報は環境変数で管理
- コード実行のサンドボックス化を検討

### パフォーマンス
- コード実行のタイムアウト設定（デフォルト30秒）
- 大量データ出力の制限（最大1MB）
- カタログ概要取得でコンテキストを節約

### 可用性
- 各コンポーネントは独立してデプロイ可能
- カーネルクラッシュ時の自動復旧

## 開発フェーズ

### Phase 1: Jupyter環境構築
- [ ] jupyter-server のDockerイメージ作成
- [ ] jupyter-mcp の基本ツール実装（session, execute_code）
- [ ] 画像リソース機能の実装
- [ ] 単体での動作確認

### Phase 2: カタログ機能
- [ ] サンプルカタログYAMLの作成
- [ ] document-server のAPI実装
- [ ] document-mcp の2段階ツール実装
- [ ] カタログ参照の動作確認

### Phase 3: 統合
- [ ] 全コンポーネントの結合テスト
- [ ] エンドツーエンドシナリオの検証
- [ ] パフォーマンスチューニング

## 参考リンク

- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Jupyter Server REST API](https://jupyter-server.readthedocs.io/en/latest/developers/rest-api.html)
