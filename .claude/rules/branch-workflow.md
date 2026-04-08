# ブランチ運用ルール

## ブランチモデル

```
main (公開・リリース済み、直接 push 禁止)
 └── dev (統合・検証用)
      ├── feature/{番号}-{名前}  ← dev から切る（機能開発）
      ├── fix/{issue番号}-{名前}  ← dev から切る（バグ修正）
      └── ...
```

## 作業ルール

- **すべての変更は `feature/*` または `fix/*` ブランチで行い、PR 経由で `dev` にマージする**（ドキュメントのみの変更も含む）
- `dev` / `main` への直接 push は GitHub ブランチ保護で拒否される
- PR マージには CI（4 ジョブ）のパスが必須（ドキュメントのみの変更では CI ジョブの実質的な処理はスキップされ、即 Success となる）
- **PR 作成後、Claude は CI 完了まで待機し、失敗時は自動修正を試みる**（下記「PR 作成後の CI 待機と自動修正」参照）
- **PR のマージ判断はユーザーが行う**（Claude は CI グリーン化までで停止する）
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する

### PR 作成後の CI 待機と自動修正

PR 作成後、`gh pr checks {PR番号} --watch` で CI 完了を待機する。マージは実行しない。

- **CI PASS** → PR URL と成功を報告して終了
- **CI FAIL（自タスク起因）** → 修正 + push + 再待機（最大 5 回）。5 回超はユーザーにエスカレーション
- **CI FAIL（自タスク無関係）** → `.claude/rules/test-failure-workflow.md` に準ずる

#### 原則

- PR は再作成しない。追加コミットで CI を再実行させる
- Claude はマージ・ブランチ切り替え・リベースを行わない（自タスク起因の修正のみ現ブランチで実施）
- `gh pr merge`・dev 切り替え・ローカルブランチ削除・Issue クローズは、ユーザーの明示的な依頼がある場合のみ実行する

### ドキュメントのみの変更

要件変更やプラン更新等のドキュメントのみの変更も、`feature/docs-{短い英語名}` ブランチを切って PR 経由でマージする。

## ブランチ命名規則

| フロー | ブランチ名 | 例 |
|--------|-----------|-----|
| 単一タスク | `feature/{番号}-{短い英語名}` | `feature/2.3-term-search-related-terms` |
| 複数タスク | `feature/{開始番号}-{終了番号}-{短い英語名}` | `feature/2.3-2.5-term-search-enhancement` |
| バグ修正 | `fix/{issue番号}-{短い英語名}` | `fix/46-db-connection-freeze` |

英語名はタスク内容またはIssueタイトルから生成する（kebab-case）。

## ブランチ操作

### ブランチ確認（コマンド開始時の共通ステップ）

ブランチを作成/切り替えするコマンドは、操作の前に以下の確認を行うこと。

1. 現在のブランチを取得する（`git branch --show-current`）
2. 現在のブランチが `feature/*` または `fix/*` の場合:
   - ブランチ名と直近のコミットメッセージ（`git log -1 --format=%s`）を提示する
   - `AskUserQuestion` で以下を確認する:
     - **このブランチで続行する** — 現在のブランチをそのまま使う
     - **新しいブランチを作成する** — 下記「ブランチ作成」に従い新規作成する
3. 現在のブランチが `dev` または `main` の場合:
   - 確認なしで「ブランチ作成」に進む

### ブランチ作成

dev ブランチの最新状態から新しいブランチを作成する。

```bash
git checkout dev
git pull origin dev
git checkout -b {ブランチ名}
```

### ブランチ切り替え

既存のブランチに切り替える。ブランチが存在しない場合は「ブランチ作成」を行う。

```bash
# ブランチの存在確認
git branch --list '{ブランチ名パターン}'

# 存在する場合
git checkout {ブランチ名}

# 存在しない場合 → ブランチ作成を行う
```

### PR 作成（feature/fix → dev）

PR 本文は `tmp/pr-body.md` に書き出してから `gh pr create` に渡す（heredoc 禁止）。

```bash
git push -u origin {ブランチ名}
```

1. Write ツールで `tmp/pr-body.md` を作成:

```markdown
## Summary
{箇条書きで変更内容}

## Test plan
{テスト計画}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

2. PR を作成:

```bash
gh pr create --base dev --title "{タイトル}" --body-file tmp/pr-body.md
```

PR タイトルは短く（70文字以内）。詳細は body に記述する。
`tmp/pr-body.md` は PR 作成後に削除する。

### マージ後のクリーンアップ（ユーザー依頼時のみ）

ユーザーから明示的に依頼された場合のみ実行する。PR 作成直後に自動実行してはならない。

```bash
# 現在のブランチ名を記録
BRANCH=$(git branch --show-current)

# PR をマージ（merge commit 方式 + リモートブランチ削除）
gh pr merge {PR番号} --merge --delete-branch

# dev に切り替え
git checkout dev
git pull origin dev

# ローカルブランチを削除
git branch -d "$BRANCH"
```

リモートブランチは `--delete-branch` オプションで削除される。

バグ修正 PR の場合は、マージ前に Issue もクローズする：

```bash
gh issue close {Issue番号}
```

### dev への統合

PR 経由で `feature/*` または `fix/*` → `dev` にマージ。

### main へのリリース

`scripts/promote-to-main.sh`（dev ブランチで実行）

## 禁止事項

- `main` ブランチで `git commit` を実行すること（フックでブロックされる）
- `main` / `dev` ブランチに直接 `git push` すること（GitHub ブランチ保護で拒否される）
- 変更を `dev` ブランチで直接行うこと（ドキュメント変更も含め feature/fix ブランチを使う）
- Claude が PR を自動マージすること（ユーザーの明示的な依頼がない限り実行しない）
- Claude が自タスク無関係な CI 失敗を現在の feature/fix ブランチで修正すること（スコープ混在を防ぐため、必ず別 fix ブランチで対応する）
