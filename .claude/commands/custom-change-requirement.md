要件を変更します。

変更内容: $ARGUMENTS

以下の手順で作業してください：

## 1. 変更種別とコンポーネントの特定（メインで直接実行）

まず、`docs/STRUCTURE.md` の「更新の依存関係」表を Read ツールで確認してください。
**サブエージェントは使わず、メインで直接読むこと。**

次に、今回の変更「$ARGUMENTS」について以下を特定してください：

### 変更種別

- `mcp_tool` — MCPツールの追加・変更
- `rest_api` — REST APIの追加・変更
- `architecture` — アーキテクチャ変更
- `dataflow` — データフロー変更
- `new_component` — 新コンポーネント追加
- `other` — その他

### 影響コンポーネント

- 影響を受けるコンポーネント名をすべて列挙
  - jupyter-server / jupyter-mcp / jupyterlab-ai-sync / document-server / document-mcp

## 2. 影響範囲の並列調査（必要なサブエージェントのみ起動）

ステップ1で特定した**変更種別**と**影響コンポーネント**に基づき、以下の起動判定表に従ってサブエージェントを選択してください。

**必要なものだけを選び、1 つのメッセージで並列に起動すること。**

### 起動判定表

| Agent | 起動条件 | subagent_type | model |
|-------|----------|---------------|-------|
| A: 要件定義の影響 | **常に起動** | `impact-analyzer` | `haiku` |
| B: API 仕様の影響 | `mcp_tool` / `rest_api` のみ | `impact-analyzer` | `haiku` |
| C: 全体像の影響 | `architecture` / `dataflow` / `new_component` のみ | `impact-analyzer` | `haiku` |
| D: コード影響 | **常に起動** | `impact-analyzer` | `sonnet` |
| E: タスク・計画の影響 | **常に起動** | `impact-analyzer` | `haiku` |
| F: 異常系・不変条件レンズ | **常に起動** | `impact-analyzer` | `sonnet` |

まず `.claude/skills/parallel-investigation/SKILL.md` を読み、テンプレートを確認してください。

### Agent A — 要件定義の影響調査

**テンプレート A**（単一ドキュメント読み取り）を使用:
- ファイル: `docs/requirements/{コンポーネント名}.md`
- subagent_type: `impact-analyzer`, model: `haiku`
- 目的: 要件変更「$ARGUMENTS」による要件定義ファイルへの影響調査
- コンテキスト: 変更内容「$ARGUMENTS」、対象コンポーネント
- 出力: 影響があるセクション名と行番号、具体的な変更案、影響がなければ「影響なし」

※コンポーネントが複数ある場合は、コンポーネントごとに Agent A を分けて起動してください。

### Agent B — API 仕様の影響調査

**テンプレート A**（単一ドキュメント読み取り）を使用:
- ファイル: `docs/design/api-contracts.md`
- subagent_type: `impact-analyzer`, model: `haiku`
- 目的: 要件変更「$ARGUMENTS」による API 仕様への影響調査
- コンテキスト: 変更内容「$ARGUMENTS」、対象コンポーネント
- 出力: 影響があるセクション名と行番号、具体的な変更案、影響がなければ「影響なし」

### Agent C — 全体像の影響調査

**テンプレート A**（単一ドキュメント読み取り）を使用:
- ファイル: `docs/overview.md`
- subagent_type: `impact-analyzer`, model: `haiku`
- 目的: 要件変更「$ARGUMENTS」によるプロジェクト全体像への影響調査
- コンテキスト: 変更内容「$ARGUMENTS」
- 出力: 影響があるセクション名と行番号（アーキテクチャ図、ユースケースフロー、ツール/API一覧表、データフロー）、具体的な変更案、影響がなければ「影響なし」

### Agent D — コード影響の調査

**テンプレート B**（コード調査）を使用:
- コンポーネント: `{コンポーネント名}`
- subagent_type: `impact-analyzer`, model: `sonnet`
- 目的: 要件変更「$ARGUMENTS」によるソースコードへの影響調査
- 調査対象の追加指示: {コンポーネント名}/CLAUDE.md のツール/API 一覧への影響確認を含める
- 出力: CLAUDE.md の影響箇所、影響を受けるソースファイル一覧（パスと関連箇所）、影響を受けるテストファイル一覧（パスと関連箇所）

※コンポーネントが複数ある場合は、コンポーネントごとに Agent D を分けて起動してください。

### Agent E — タスク・計画の影響調査

**テンプレート B**（コード調査）を使用:
- コンポーネント: `docs/plan/` および `docs/tasks/`
- subagent_type: `impact-analyzer`, model: `haiku`
- 目的: 要件変更「$ARGUMENTS」によるタスク管理と計画への影響調査
- 調査対象: `docs/plan/README.md`（インデックス）→ 対象カテゴリファイル（`docs/plan/01-jupyter.md` 等）、`docs/tasks/` 配下の既存計画ファイル（Glob: `docs/tasks/**/*.md`）
- コンテキスト: 変更内容「$ARGUMENTS」
- 出力: `docs/plan/` カテゴリファイルの影響箇所、影響を受けるタスク計画ファイル一覧、具体的な変更案

### Agent F — 異常系・不変条件レンズによる要件レビュー

**テンプレート A**（単一ドキュメント読み取り）を使用:
- ファイル: `docs/design/invariants.md`
- subagent_type: `impact-analyzer`, model: `sonnet`
- 目的: 要件変更「$ARGUMENTS」の敵対的レビュー。この要件が壊れる状況の列挙と、横断不変条件への抵触確認
- コンテキスト: 変更内容「$ARGUMENTS」、対象コンポーネント
- 出力: (1) この要件が壊れる状況（切断・再起動・並行・タイムアウト・不正入力・データ量の各観点で該当するもの）と、受け入れ条件に追加すべき異常系の具体案 (2) 抵触する不変条件の番号と理由（なければ「抵触なし」） (3) ADR を書くべき設計判断が含まれるか（`docs/adr/README.md` の契機に照らして）

### 調査結果の統合

すべてのエージェントの結果を統合して、影響箇所の詳細リストを作成してください。Agent F が提案した異常系の受け入れ条件は、要件定義への変更案に含めてください。

## 3. 影響箇所の詳細リストアップ

影響を受けるファイルと、**具体的にどのセクション・どの行**が影響を受けるかをリストアップしてください。

```
例：
1. docs/requirements/jupyter-mcp.md
   - 「## MCPツール定義」セクションに新しいツールを追加
   - 「## 受け入れ条件」に新しい項目を追加

2. docs/overview.md
   - 「### jupyter-mcp」の「提供するMCPツール」表に行を追加

3. docs/design/api-contracts.md
   - 「## jupyter-server API」に新しいエンドポイントを追加

4. jupyter-mcp/CLAUDE.md
   - 「## MCPツール一覧」表に行を追加

5. docs/plan/{カテゴリファイル}
   - 該当セクションにタスクを追加
```

## 4. 確認

影響箇所の詳細リストを私に提示し、変更を進めてよいか確認を求めてください。

**確認を得るまで、実際のファイル変更は行わないでください。**

## 5. 次のステップの案内

影響箇所の提示後、ユーザーに以下を案内してください：

> 変更内容を確認いただけたら、`/custom-apply-change` コマンドで変更を適用してください。

**重要: この段階で直接ファイルを変更してはいけません。必ず `/custom-apply-change` コマンドを通して変更を適用してください。**
