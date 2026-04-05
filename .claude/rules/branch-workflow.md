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
- PR マージには CI（4 ジョブ）のパスが必須
- **PR 作成後、Claude は CI 完了まで待機し、失敗時は自動修正を試みる**（下記「PR 作成後の CI 待機と自動修正」参照）
- **PR のマージ判断はユーザーが行う**（Claude は CI グリーン化までで停止する）
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する

### PR 作成後の CI 待機と自動修正

Claude は feature/fix → dev の PR を作成した後、**CI 完了まで待機し、失敗時は自動修正を試みる**。マージは実行しない。

#### 基本フロー

1. `gh pr create` で PR を作成し、PR 番号を取得する
2. `gh pr checks {PR番号} --watch` で CI 完了を待機する（タイムアウトなし）
3. 結果判定:
   - 全 PASS → PR URL と CI 成功を報告してコマンド終了
   - FAIL → 下記「CI 失敗時の対応」に進む

#### CI 失敗時の対応

失敗ログを取得し（`gh run view {run_id} --log-failed`）、失敗原因が **自タスク起因** か **自タスク無関係** かを判定する。

**自タスク起因の場合 — 自動修正ループ（最大 5 回）:**

1. サブエージェントで失敗原因を分析・修正
2. `git commit` + `git push` で feature ブランチに追加コミット（GitHub が自動で CI を再実行）
3. `gh pr checks {PR番号} --watch` で再度待機
4. PASS するまで繰り返す（最大 5 回）
5. 5 回修正しても FAIL の場合 → PR を赤のまま残し、ユーザーにエスカレーション

**自タスク無関係の場合 — `.claude/rules/test-failure-workflow.md` に準ずる:**

1. `scripts/manage-known-failures.sh check {コンポーネント名}` で既知障害か確認
2. **登録済み（既知障害）**: CI は赤のまま残し、「既知障害のみで失敗」と報告して終了（マージ可否はユーザーが判断）
3. **未登録**: `AskUserQuestion` で 3 択をユーザーに確認：
   - **記録して継続**: 既知障害に登録 → PR 赤のまま終了
   - **Issue 起票して継続**: Issue 作成 + 既知障害登録 → PR 赤のまま終了
   - **修正する**: Claude は自律修正を停止し、ユーザーにエスカレーション（別 fix ブランチでの対応は `.claude/rules/bug-fix-workflow.md` に従う。現在の feature ブランチでは**無関係な修正を混ぜない**）

#### 原則

- **PR は再作成しない**。最初に作った 1 つの PR を使い回し、追加コミットで CI を再実行させる
- **Claude 自身はブランチ切り替え・マージ・リベースを行わない**。自タスク起因のときだけ現在のブランチで修正する
- `gh pr merge`・dev 切り替え・ローカルブランチ削除・Issue クローズは、**ユーザーが実施する**か、**ユーザーから明示的に依頼を受けた時のみ** Claude が実行する

理由: dev に何を入れるかはユーザーが判断する。複数の open PR から採用するものを選ぶ運用のため、自動マージしない。ただし CI がグリーンになるまではタスクの一部と見なし、Claude が責任を持つ。

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
gh pr create --base dev --title "{タイトル}" --body "$(cat tmp/pr-body.md)"
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
