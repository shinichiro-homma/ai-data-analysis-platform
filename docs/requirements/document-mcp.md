# document-mcp 要件定義

## 概要

生成AIエージェントがデータ分析を自律的に実行するために必要な**コンテキスト情報**を提供するMCPサーバー。document-serverのREST APIをラップし、MCPツールとしてAIエージェントに提供する。

### 3つのコンテキスト情報

Document MCPは以下の3種類のコンテキスト情報を管理・提供する。

| # | コンテキスト | 役割 | 具体例 |
|---|---|---|---|
| 1 | 用語集（ドメイン用語） | AIがユーザーの言葉を正しく理解する | ロイヤルティランク、統合会員ID、店舗、店舗回遊 等 |
| 2 | データカタログ | AIが正しいテーブル・カラムを選択する | テーブル定義、カラム定義、結合キー、注意点 等 |
| 3 | 既存ロジック | AIが組織の標準ロジックに従う | 会員ID洗い替えSQL、売上集計クエリ、効果検証スクリプト 等 |

### システム構成

```
AIエージェント ←(MCP)→ Document MCP ←(REST)→ document-server ←(読取)→ YAMLファイル群
                ←(MCP)→ Jupyter MCP  ←→ Jupyter Server ←→ データベース / CSVデータ
```

### 設計原則

#### コンテキスト間の関係性：AIの意味理解に委ねる

3つのコンテキスト間の紐付け（例：用語→テーブル/カラム、ロジック→テーブル）は、明示的なリンク（外部キー的な参照）を持たせず、AIの意味的マッチングに委ねる。

**理由：**
- 明示的リンクはメンテナンスコストが高い
- LLMは意味的マッチングが得意
- コンテキスト情報は運用で育てていくものなので、管理対象間の依存関係は最小限にすべき

**前提条件：**
- データカタログ側のカラム説明に業務用語を十分含めること
- 既存ロジック側の目的説明にも業務用語を使うこと

#### 2層構造：インデックス＋詳細

3つのコンテキスト全てに共通して、2層構造を採用する。

| 層 | 内容 | 取得タイミング | 目的 |
|---|---|---|---|
| **第1層：インデックス** | 全項目の名前＋概要 | 各Phaseで必要時に取得 | AIが全体像を把握し、必要な項目を特定する |
| **第2層：詳細** | 各項目の詳細情報 | 必要な項目のみ個別取得 | コンテキストウィンドウを節約しつつ詳細を参照する |

## 機能要件

### F1: テーブルインデックス取得（第1層）

コンテキストを圧迫しないよう、軽量なインデックス情報のみを返却する。

#### F1.1: 全テーブルインデックス
- カタログ内の全テーブルのインデックスを取得
- 返却情報: テーブル名、表示名、概要、カテゴリ
- カラム情報や統計量は含まない

### F2: テーブル詳細取得（第2層）

利用すべきテーブルが特定できたら、詳細情報を取得する。

#### F2.1: テーブル詳細取得（一括対応）
- 指定テーブル（複数指定可）のカタログ情報を取得
- 基本情報、データソース、カラム定義、基本統計量（テーブル固有の拡張統計項目を含む）、テーブルレベル注意点の5セクションで構成
- カラム定義にはkey_type/key_types（結合キー種別）とdomain（値のドメイン定義）を含む
- key_typesは条件付きキー種別で、別カラムの値によってキー種別が異なる場合に使用する（key_typeと排他）。conditionがnullの場合はデフォルトのキー種別を表す
- domainには2つのバリアントがある: マスタ参照型（master_table, master_column, label_column）と固定値リスト型（values配列）
- `data_source.type` が `csv` のテーブルも取得可能。CSVファイルをデータソースとするテーブルの場合、`file_path` と `encoding` フィールドが含まれる
- `data_source.type` が `external` のテーブルも取得可能。外部データの場合、DBにはテーブルが存在せず、カタログ定義（スキーマ情報）のみを保持する
- external型の `data_source` には `format`（ファイル形式: csv, excel等）と `description`（データの説明）フィールドが含まれる

### F3: 用語インデックス取得（第1層）

#### F3.1: 用語インデックス（検索対応）
- 用語集の用語インデックスを取得
- 返却情報: 用語名、一行説明
- オプションの query パラメータで部分一致検索できる（検索対象は `docs/requirements/document-server.md` F3.1 を参照）
- query 指定時はヒットした用語のみ返却、省略時は全件返却

### F4: 用語詳細取得（第2層）

#### F4.1: 用語詳細取得（一括対応）
- 指定用語（複数指定可）の詳細情報を取得
- 返却情報: 用語名、別名（aliases）、定義、関連用語、値の体系

### F5: ロジックインデックス取得（第1層）

#### F5.1: 全ロジックインデックス
- 既存ロジックの全インデックスを取得
- 返却情報: ロジック名、概要、カテゴリ

### F6: ロジック詳細取得（第2層）

#### F6.1: ロジック詳細取得（一括対応）
- 指定ロジック（複数指定可）のメタ情報を取得
- 返却情報: 説明、ファイルパス、言語、usage_type、入力テーブル、出力説明、利用コンテキスト、関連ロジック、注意点
- コード本体は含まない（F7で別途取得）

### F7: ロジックコード取得

#### F7.1: ロジックコード取得
- 指定ロジックのコードファイルの中身を取得
- 返却情報: ロジック名、言語、コード本体

## MCPツール定義

### get_table_index（第1層：テーブルインデックス）

全テーブルのインデックスを取得する。最初にカタログ全体を把握するために使用。

> ツール定義（name, description, inputSchema）: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

### get_table_detail（第2層：テーブル詳細）

指定テーブルのカタログ情報を取得する。複数テーブルを一度に取得できる。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照
> 戻り値の構造: `document-mcp/src/tools/table-detail.ts` の `execute` 関数を参照

### get_term_index（第1層：用語インデックス）

用語のインデックスを取得する。AIが業務用語を把握するために使用。オプションで検索クエリを指定して、用語名および別名（aliases）で部分一致検索できる。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

### get_term_detail（第2層：用語詳細）

指定用語の詳細情報を取得する。複数用語を一度に取得できる。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

### get_logic_index（第1層：ロジックインデックス）

既存ロジックの全インデックスを取得する。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

### get_logic_detail（第2層：ロジック詳細）

指定ロジックのメタ情報を取得する。複数ロジックを一度に取得できる。コード本体は含まない。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

### get_logic_code（ロジックコード取得）

指定ロジックのコードファイルの中身を取得する。

> ツール定義: `document-mcp/src/tools/index.ts` の `toolRegistry` を参照

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| ツール応答時間 | document-server応答 + 50ms以内 |

### NF2: エラーハンドリング

- document-serverへの接続エラーを適切にハンドリング
- 用語・テーブル・ロジックが見つからない場合は明確なメッセージを返却
- 一括取得で一部のみ見つからない場合は、見つかったものと見つからなかったもの両方を返却

### NF3: ログ

- 全ツール呼び出しの開始・完了・エラーをログ出力する
- ログレベル: 呼び出し開始・完了は `info`、エラーは `error`
- ログに含める情報: ツール名、取得対象の名前（分析改善のため）、実行時間
- ログ出力先: stderr（MCP SDKの標準）
- **実装方針:** MCP SDK の標準ログ機構（`console.error` → stderr）を使用。環境変数 `LOG_LEVEL` でログレベルを制御

## 技術仕様

### 技術スタック

- TypeScript
- MCP TypeScript SDK (`@modelcontextprotocol/sdk`)
- axios（HTTPクライアント）

### 環境変数

> **正（SSoT）**: 環境変数の定義は各コンポーネントの `CLAUDE.md` を参照。ここでは要件としての説明のみ記載。

| 変数名 | 説明 |
|--------|------|
| `DOCUMENT_SERVER_URL` | document-serverのURL |
| `LOG_LEVEL` | ログレベル |

> デフォルト値は `document-mcp/CLAUDE.md` を参照。

### コマンド

> **正（SSoT）**: 開発コマンドは `document-mcp/CLAUDE.md` を参照。

## 受け入れ条件

### AC1: 用語集
- [ ] get_term_index で全用語のインデックスが取得できる（query なし）
- [ ] get_term_index に query を指定すると、name + aliases で部分一致検索できる
- [ ] get_term_index の検索結果が0件の場合、空配列が返る
- [ ] get_term_detail で指定用語の詳細が取得できる
- [ ] get_term_detail で複数用語を一度に取得できる
- [ ] 存在しない用語名を指定した場合に明確なエラーメッセージが返る

### AC2: データカタログ
- [ ] get_table_index で全テーブルのインデックスが取得できる（外部データ定義を含む）
- [ ] get_table_detail で指定テーブルの全情報が取得できる
- [ ] get_table_detail で複数テーブルを一度に取得できる
- [ ] カラム定義（key_type/key_types, domain含む）、data_source、statistics（additional含む）、notes_table_levelが含まれる
- [ ] statistics に additional（テーブル固有の拡張統計項目）が定義されている場合、テーブル詳細レスポンスに含まれる
- [ ] statistics に additional が未定義の場合でも、固定フィールド（row_count, date_range, update_frequency）のみで正常に返却される
- [ ] 条件付きkey_types（配列形式）を持つカラムが正しく返却される
- [ ] key_types の condition が null（デフォルトキー種別）のエントリが正しく返却される
- [ ] DomainValues 型（固定値リスト）の domain を持つカラムが正しく返却される
- [ ] `data_source.type` が `csv` のテーブル詳細が正しく返却される（file_path, encoding フィールド含む）
- [ ] `data_source.type` が `external` のテーブル詳細が正しく返却される（format, description フィールド含む）

### AC3: 既存ロジック
- [ ] get_logic_index で全ロジックのインデックスが取得できる
- [ ] get_logic_detail で指定ロジックのメタ情報が取得できる
- [ ] get_logic_detail で複数ロジックを一度に取得できる
- [ ] get_logic_code で指定ロジックのコードファイルの中身が取得できる

### AC4: MCPプロトコル
- [ ] MCP Inspector で全7ツールが表示される
- [ ] Claude Desktop から接続して操作できる

## AIエージェント向け使用ガイドライン

### エージェント参照フロー

AIエージェントはユーザーの分析リクエストに対して、以下のPhaseを自律的に判断して実行する。各Phaseのスキップ・順序変更はAIが判断する。

```
ユーザーの質問を受け取る
    │
    ├─ 不明な業務用語がある場合 ──→ Phase 1：用語集参照（再帰的解決）
    │                                    │
    │                                    ├─ 用語集で解決 → 次へ
    │                                    └─ 用語集にもない → ユーザーに質問
    │
    ├─ データの特定が必要 ──→ Phase 2：データカタログ参照
    │                              │
    │                              ├─ カラム説明に不明用語 → Phase 1に戻る
    │                              └─ テーブル・カラム確定 → 次へ
    │
    ├─ 既存ロジックが使えそう ──→ Phase 3：既存ロジック参照
    │   （AIが判断）                    │
    │                              ├─ template → コード取得 → パラメータ修正
    │                              └─ reference → コード取得 → 参考に新規作成
    │
    └─ Phase 4：Jupyter MCPで分析実行
```

**設計ポイント：**
- Phase間の遷移は一方通行ではなく、必要に応じてPhase 1に戻れる
- 第1層インデックスは各Phaseで必要時に遅延取得する（初回一括取得はしない）
- Phase 1、Phase 3はAIが不要と判断すればスキップ可能
- Phase 2は分析実行時にほぼ必須

### 具体例：「11月ポイントCPの店舗別・ロイヤルティランク別の買上額を集計して」

```
1. 質問を受け取り、「ポイントCP」「館」「ロイヤルティランク」「買上額」を認識
   → 「ロイヤルティランク」の正確な意味を確認したい

2. Phase 1：get_term_index(query="ポイントCP") で検索
   → 「ポイントキャンペーン」がヒット
   → get_term_index(query="ロイヤルティランク") で検索 → ヒット
   → get_term_detail(["ポイントキャンペーン", "ロイヤルティランク"]) で詳細取得
   → related_termsに「統合会員ID」→ get_term_detail(["統合会員ID"]) で追加取得
   → 用語理解完了

3. Phase 2：get_table_index() を呼び出し
   → 全テーブル概要を確認
   → 「purchase_history」「customer_master」「campaign_master」が必要と判断
   → get_table_detail(["purchase_history", "customer_master", "campaign_master"])
   → カラム定義・key_type・data_sourceを確認

4. Phase 3：get_logic_index() を呼び出し
   → 「member_id_remapping」（前処理）と「sales_basic_aggregation」（集計）が該当
   → get_logic_detail(["member_id_remapping", "sales_basic_aggregation"])
   → usage_type: template → get_logic_code("member_id_remapping") でコード取得

5. Phase 4：Jupyter MCPで実行
   → 会員ID洗い替えSQLをパラメータ修正して実行
   → 集計ロジックを参考に店舗別・ロイヤルティランク別の買上額を集計
```

### ベストプラクティス

- **ユーザーの質問に業務用語が含まれる場合は、まず用語を理解する**
  - 略称や不明な用語がある場合は get_term_index(query="略称") で検索
  - 全体像を把握したい場合は get_term_index()（query なし）で全件取得
  - get_term_detail で用語の詳細を取得し、意味を理解してからテーブルを探す

- **get_table_index は分析時に必ず呼び出す**
  - どんなデータがあるか全体像を把握する
  - ユーザーのリクエストに合うテーブルを見つける

- **get_table_detail は必要なテーブルのみ取得する**
  - 一括取得で効率よく取得し、十分な情報が揃ったか判断する
  - 不要なテーブルの詳細は取得しない

- **notes_table_level を必ず確認する**
  - テーブル全体の注意事項・落とし穴
  - フィルタ条件の推奨
  - データの更新タイミング

- **外部データ（data_source.type: external）を識別する**
  - get_table_detail で `data_source.type` が `external` の場合、DBにデータが存在しない
  - AIはユーザーに該当データ（CSV/Excelファイル）の提供を依頼する
  - 提供されたデータはワークスペースに配置してから分析に使用する

- **key_type/key_types と domain を活用する**
  - key_type（単一）でテーブル結合のキーを判断
  - key_types（条件付き）がある場合、condition を確認して適切なキーを選択
  - domain でカラムの取りうる値を確認

- **既存ロジックの活用を検討する**
  - get_logic_index で使えるロジックがあるか確認
  - usage_type: template ならパラメータを変えてそのまま使う
  - usage_type: reference なら参考にして新たに書く

### テーブル結合の判断方法

key_type/key_types方式により、AIは以下の段階でテーブル結合を判断する:

1. **両方にkey_typeあり（最も確実）**: 同じkey_typeを持つカラム同士を結合
2. **key_typesあり（条件付き）**: conditionを確認し、適切なkey_type値を選択して結合。結合時にWHERE句で条件カラムのフィルタが必要になる場合がある
3. **片方のみkey_type/key_typesあり**: key_typeの値をヒントに、もう片方のdescriptionから意味的にマッチング
4. **両方key_typeなし**: description同士の意味的マッチング + 用語集の知識で判断。確信が持てなければユーザーに確認

### 再帰的用語解決

用語詳細を取得した際、definition内にさらに不明な用語があれば追加で取得する:

1. related_termsがあれば、それらの用語詳細も取得する
2. definition内に第1層インデックスに存在する不明用語があれば、それも取得する
3. 不明な用語がなくなるまで繰り返す

## 依存関係

- document-server が起動していること
- Jupyter MCPが分析実行環境として利用可能であること
