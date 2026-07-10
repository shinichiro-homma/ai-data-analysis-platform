---
name: doc-code-audit
description: ドキュメントとコードの整合性（欠落・陳腐化・冗長）を監査する共通ロジック。audit-docs / auto-audit-docs コマンドから使用する。
---

# Doc-Code Consistency Audit Skill

ドキュメントとコードの整合性を監査するための共通ロジック。
`/custom-audit-docs`（報告のみ）と `/custom-auto-audit-docs`（自動修正）の両方から参照される。

## 対象コンポーネント

- jupyter-mcp
- document-server
- document-mcp
- jupyter-server
- jupyterlab-ai-sync

## サブエージェント設定

| 設定 | 値 |
|------|-----|
| subagent_type | `requirements-verifier` |
| model | `sonnet` |
| 並列数 | 最大 5（コンポーネントごとに 1 エージェント） |

## 監査プロンプトテンプレート

以下のテンプレートを使用してサブエージェントを起動する。
`{コンポーネント名}` と `{出力形式}` を呼び出し側で置換すること。

```
コンポーネント「{コンポーネント名}」のコードとドキュメントの整合性を監査してください。

## 監査の3つのモード

### A. 欠落検出（コードにあるがドキュメントにない）

前提: ツール名・エンドポイント名の**一覧レベル**の同期は CI（`scripts/check-docs-consistency.py`）が自動検証する。監査ではそれより深い**意味レベル**を中心に見ること。

チェック手順:
1. {コンポーネント名}/src/ のソースコードから、公開ツール・APIエンドポイントとその振る舞いを抽出する
2. 以下を確認する:
   - docs/requirements/{コンポーネント名}.md のツール一覧表にツール名が記載されているか（MCPコンポーネントのみ）
   - docs/design/api-contracts.md のエンドポイント一覧表に記載されているか（server コンポーネントのみ）
   - 実装済みの機能に対応する機能要件（F番号）・受け入れ条件が docs/requirements/{コンポーネント名}.md に存在するか

チェック対象外: 入出力スキーマ・パラメータ・デフォルト値・上限値・許可リスト等（コードが正であり、ドキュメントに存在しないのが正しい状態）、description 文言。

### B. 陳腐化検出（ドキュメントにあるがコードにない）

チェック手順:
1. ドキュメントに記載されたツール名・エンドポイント名・機能説明がコードと一致するか確認する
2. 一致しない場合、以下を区別する:
   - 削除された機能（かつてコードに存在し、削除された）
   - 未実装の将来要件（ステータスが明記されていれば OK、されていなければ不整合）
   - 説明文・Why・受け入れ条件が現在の実装の振る舞いと矛盾している（意味レベルの陳腐化）

### C. 冗長検出（コードを見れば分かる詳細がドキュメントに書かれている）

冗長検出の判定基準は `.claude/rules/documentation.md` の「ドキュメントに書いてはいけない情報」を参照すること。

冗長検出の対象ドキュメント:
- docs/requirements/{コンポーネント名}.md
- {コンポーネント名}/CLAUDE.md
- docs/design/api-contracts.md（server/mcp コンポーネントのみ）

注意: docs/overview.md と README.md は概要レベルなので冗長検出の対象外とする。

{出力形式}
```

## 出力形式

### Markdown 形式（audit-docs 用）

`{出力形式}` に以下を埋め込む:

```
## 出力形式

以下の形式で結果を報告してください:

### 判定
整合 / 欠落あり / 陳腐化あり / 冗長あり（複数該当可）

### A. 欠落（ある場合のみ）
- ファイルパス: 具体的な差異

### B. 陳腐化（ある場合のみ）
- ファイルパス: 具体的な差異

### C. 冗長（ある場合のみ）
- ファイルパス: 冗長な記述の内容と場所（行番号）
```

### JSON 形式（auto-audit-docs 用）

`{出力形式}` に以下を埋め込む:

```
## 出力形式

以下の JSON 形式で結果を報告してください（パース用）:

{
  "component": "{コンポーネント名}",
  "status": "clean" | "issues_found",
  "issues": [
    {
      "type": "missing" | "stale" | "redundant",
      "file": "ファイルパス",
      "file_category": "requirements" | "claude_md" | "overview" | "api_contracts" | "readme",
      "description": "具体的な差異の説明",
      "lines": "行番号（分かれば）"
    }
  ]
}

issues が空なら status は "clean" にしてください。
```

## 修正方針（auto-audit-docs で使用）

### ファイルカテゴリ分類

| カテゴリ | 対象ファイル | 修正方法 |
|---------|------------|---------|
| A: 要件定義 | `docs/requirements/*.md`, `docs/overview.md`, `docs/design/api-contracts.md` | change-requirement ワークフロー |
| B: その他 | `*/CLAUDE.md`, `README.md` | 直接修正 |

### 修正ルール

| 種別 | 対応 |
|------|------|
| 冗長（redundant） | 定数値・実装詳細を削除、または「コード参照」に置き換え |
| 欠落（missing） | ツール/API を一覧表に追加 |
| 陳腐化（stale） | 存在しないツール/API を一覧表から削除 |

### 要件定義ドキュメントの変更順序

1. `docs/requirements/*.md`
2. `docs/design/api-contracts.md`
3. `docs/overview.md`

## 不整合検出時の修正案内テンプレート

不整合を検出した場合に出力する案内テキスト。`/custom-complete-task` と `/custom-audit-docs` から参照される。

```
### 次のステップ

**A. 欠落 / B. 陳腐化の修正:**

要件定義ドキュメントの不整合（docs/requirements/*, docs/overview.md, docs/design/api-contracts.md）:
1. `/custom-change-requirement {不整合の内容を要約した文}`
2. `/custom-apply-change`

その他のドキュメントの不整合（README.md, */CLAUDE.md 等）:
直接修正してコミットしてください。

**C. 冗長の修正:**

冗長な記述は、コード参照に置き換えるか削除してください。
要件定義ドキュメントの場合は `/custom-change-requirement` → `/custom-apply-change` で修正してください。
その他のドキュメントは直接修正してコミットしてください。
```
