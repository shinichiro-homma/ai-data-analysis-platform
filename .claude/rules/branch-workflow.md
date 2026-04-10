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

- **すべての変更は `feature/*` / `fix/*` ブランチで行い、PR 経由で `dev` にマージする**（ドキュメントのみの変更も含む）
- ❌ `dev` / `main` への直接 push・`dev` での直接作業（ブランチ保護で拒否される）
- ❌ `main` での `git commit`（フックでブロックされる）
- PR マージには CI（4 ジョブ）のパスが必須（ドキュメントのみの変更は実質スキップされ即 Success）
- PR のマージ判断はユーザーが行う。Claude は CI グリーン化までで停止する
- `main` への反映は `scripts/promote-to-main.sh` 経由

### PR 作成後の CI 待機と自動修正

PR 作成後、`gh pr checks {PR番号} --watch` で CI 完了を待機する。マージは実行しない。

- **CI PASS** → PR URL と成功を報告して終了
- **CI FAIL（自タスク起因）** → 修正 + push + 再待機（最大 5 回、超過はユーザーにエスカレーション）
- **CI FAIL（自タスク無関係）** → `.claude/rules/test-failure-workflow.md` に準ずる。**別 fix ブランチで対応**（スコープ混在を防ぐため現ブランチでは修正しない）

原則:
- PR は再作成せず、追加コミットで CI を再実行させる
- Claude はマージ・ブランチ切り替え・リベースを行わない（自タスク起因の修正のみ現ブランチで実施）
- ❌ Claude が PR を自動マージすること。`gh pr merge`・dev 切り替え・ローカルブランチ削除・Issue クローズは、ユーザーの明示的な依頼がある場合のみ実行する

## ブランチ命名規則

| フロー | ブランチ名 | 例 |
|--------|-----------|-----|
| 単一タスク | `feature/{番号}-{短い英語名}` | `feature/2.3-term-search-related-terms` |
| 複数タスク | `feature/{開始番号}-{終了番号}-{短い英語名}` | `feature/2.3-2.5-term-search-enhancement` |
| バグ修正 | `fix/{issue番号}-{短い英語名}` | `fix/46-db-connection-freeze` |
| ドキュメントのみ | `feature/docs-{短い英語名}` | `feature/docs-rules-compact` |

英語名はタスク内容または Issue タイトルから kebab-case で生成する。

## ブランチ操作

### ブランチ確認（コマンド開始時の共通ステップ）

ブランチを作成/切り替えするコマンドは、操作の前に以下の確認を行うこと。

1. 現在のブランチを `git branch --show-current` で取得
2. `feature/*` / `fix/*` の場合: ブランチ名と直近コミットメッセージ（`git log -1 --format=%s`）を提示し、`AskUserQuestion` で確認する
   - **このブランチで続行する** — 現在のブランチをそのまま使う
   - **新しいブランチを作成する** — 下記「ブランチ作成」に従う
3. `dev` / `main` の場合: 確認なしで「ブランチ作成」に進む

### ブランチ作成

dev の最新状態から新しいブランチを作成する。

```bash
git checkout dev && git pull origin dev && git checkout -b {ブランチ名}
```

### ブランチ切り替え

既存ブランチに切り替える。存在しなければ「ブランチ作成」を行う。

```bash
git branch --list '{パターン}'   # 存在確認
git checkout {ブランチ名}         # 存在する場合
```

### PR 作成（feature/fix → dev）

PR 本文は `tmp/pr-body.md` に書き出してから `gh pr create` に渡す（**heredoc 禁止**）。PR タイトルは 70 文字以内、詳細は body に書く。

1. `git push -u origin {ブランチ名}`
2. Write ツールで `tmp/pr-body.md` を作成:

```markdown
## Summary
{箇条書きで変更内容}

## Test plan
{テスト計画}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

3. `gh pr create --base dev --title "{タイトル}" --body-file tmp/pr-body.md`
4. PR 作成後に `tmp/pr-body.md` を削除

### マージ後のクリーンアップ（ユーザー依頼時のみ）

ユーザーから明示的に依頼された場合のみ実行する。PR 作成直後に自動実行してはならない。バグ修正 PR の場合は、マージ前に `gh issue close {Issue番号}` で Issue をクローズする。

```bash
BRANCH=$(git branch --show-current)
gh pr merge {PR番号} --merge --delete-branch   # リモートブランチも削除される
git checkout dev && git pull origin dev
git branch -d "$BRANCH"
```

### main へのリリース

`scripts/promote-to-main.sh` を dev ブランチで実行する。
