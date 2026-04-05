要件変更を適用します。

以下の手順で作業してください：

## 0. DRY 原則の遵守

`.claude/rules/dry.md` と `.claude/rules/documentation.md` の原則に従うこと。

特に以下を守ること：
- `docs/STRUCTURE.md` の「Single Source of Truth（正）の定義」表に従い、**正のファイルに詳細を書き、サマリー/参照を置いてよい場所には名前リストや1行概要のみ書く**
- overview.md や */CLAUDE.md に、requirements や api-contracts と同じ詳細（入出力スキーマ、パラメータ説明等）を転記しない
- 整合性確認（ステップ2）では「名前の一致」を確認するが、**詳細の重複がないこと** も確認する

## 1. 変更の適用

先ほど洗い出した影響箇所に対して、変更を適用してください。

**変更順序（この順番を守ること）：**

1. **要件定義ファイル**（`docs/requirements/*.md`）
   - 機能要件の追加・変更
   - ツール/API定義の更新
   - 受け入れ条件の更新

2. **API仕様**（`docs/design/api-contracts.md`）
   - エンドポイントの追加・変更
   - リクエスト/レスポンス形式の更新

3. **全体像**（`docs/overview.md`）
   - アーキテクチャ図の更新（必要な場合）
   - コンポーネント詳細のツール/API一覧表の更新
   - データフローの更新（必要な場合）

4. **各コンポーネントの CLAUDE.md**
   - ツール/API一覧（簡易版）の更新
   - 環境変数の更新（必要な場合）

5. **ルートの CLAUDE.md**（必要な場合）
   - コンポーネント表の更新

6. **開発プラン**（`docs/plan/`）
   - `docs/plan/README.md` を読み、対象カテゴリファイルを特定
   - 該当カテゴリファイル（`docs/plan/01-jupyter.md` 等）にタスクの追加・変更

## 2. 整合性確認

変更後、以下の整合性を**必ず**確認してください：

### ツール/API名の一致
- `requirements/*.md` で定義した名前
- `overview.md` の一覧表の名前
- `*/CLAUDE.md` の一覧表の名前
- `api-contracts.md` のエンドポイント名

→ これらが**完全に一致**していることを確認

### 入出力スキーマの一致
- `requirements/*.md` で定義したスキーマ
- `api-contracts.md` のリクエスト/レスポンス形式

→ これらが**完全に一致**していることを確認

### タスクの網羅性
- 追加・変更した機能に対応するタスクが `docs/plan/` のカテゴリファイルに存在すること

## 3. コミット・プッシュ・PR 作成・CI 確認

`.claude/rules/branch-workflow.md` の「PR 作成後の CI 待機と自動修正」に従うこと。

**このコマンドは PR が作成され、CI の結果が確認できるまで完了とみなさない。**

手順:

1. `git add` で変更したファイルを個別にステージング（`git add .` は使わない）
2. `docs: {変更内容の要約}` 形式でコミット
3. `git push -u origin {ブランチ名}` でリモートにプッシュ
4. `gh pr create --base dev` で PR を作成
5. `gh pr checks {PR番号} --watch` で CI 完了を待機
6. 失敗時は `branch-workflow.md` の「CI 失敗時の対応」に従う（自タスク起因なら自動修正ループ、無関係なら既知障害フロー）

マージは実行しない（ユーザー判断）。

**コミットメッセージの例：**
- `docs: execute_code に timeout パラメータを追加`
- `docs: 新規ツール get_kernel_status を追加`
- `docs: document-mcp の2段階アプローチを導入`

## 4. 完了報告

変更が完了したら、以下の形式で報告してください：

```
## 変更完了

### 変更したファイル
1. docs/requirements/jupyter-mcp.md
   - execute_code ツールに timeout パラメータを追加
2. docs/design/api-contracts.md
   - POST /api/kernels/{id}/execute のリクエストに timeout を追加
3. docs/overview.md
   - jupyter-mcp のツール一覧表を更新
4. jupyter-mcp/CLAUDE.md
   - MCPツール一覧を更新
5. docs/plan/{カテゴリファイル}
   - タスク追加

### 整合性確認結果
- ツール名: ✓ 一致
- スキーマ: ✓ 一致
- タスク: ✓ 追加済み

### PR
- URL: https://github.com/.../pull/{番号}
- CI: ✓ pass（必須 4 ジョブ）
```
