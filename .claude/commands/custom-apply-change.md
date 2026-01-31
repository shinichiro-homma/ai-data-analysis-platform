要件変更を適用します。

以下の手順で作業してください：

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

6. **開発プラン**（`docs/PLAN.md`）
   - タスクの追加・変更
   - 変更履歴の記録

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
- 追加・変更した機能に対応するタスクが `PLAN.md` に存在すること

## 3. 変更履歴の記録

`docs/PLAN.md` の「変更履歴」セクションに、今回の変更を記録してください。

```markdown
| 日付 | 変更内容 |
|------|----------|
| YYYY-MM-DD | （変更内容の要約） |
```

## 4. 変更をコミット＆プッシュ

以下のコマンドでコミットしてプッシュしてください：

```bash
git add .
git commit -m "docs: {変更内容の要約}"
git push
```

**コミットメッセージの例：**
- `docs: execute_code に timeout パラメータを追加`
- `docs: 新規ツール get_kernel_status を追加`
- `docs: document-mcp の2段階アプローチを導入`

## 5. 完了報告

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
5. docs/PLAN.md
   - 変更履歴に記録

### 整合性確認結果
- ツール名: ✓ 一致
- スキーマ: ✓ 一致
- タスク: ✓ 追加済み

### コミット＆プッシュ
- メッセージ: docs: execute_code に timeout パラメータを追加
- プッシュ: ✓ 完了
```
