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
- **PR のマージ判断はユーザーが行う**（Claude は PR 作成までで停止する）
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する

### PR のマージ判断はユーザーが行う

Claude は feature/fix → dev の PR を**作成するまで**を担当し、マージは実行しない。

- CI 待機・`gh pr merge`・dev 切り替え・ローカルブランチ削除・Issue クローズは、**ユーザーが実施する**か、**ユーザーから明示的に依頼を受けた時のみ** Claude が実行する
- Claude は `gh pr checks --watch` 等でバックグラウンド CI 監視を起動しない
- PR 作成後は PR URL を報告してコマンドを終了する

理由: dev に何を入れるかはユーザーが判断する。複数の open PR から採用するものを選ぶ運用のため、自動マージしない。

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

```bash
git push -u origin {ブランチ名}
gh pr create --base dev --title "{タイトル}" --body "$(cat <<'EOF'
## Summary
{箇条書きで変更内容}

## Test plan
{テスト計画}

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR タイトルは短く（70文字以内）。詳細は body に記述する。

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
- Claude が `gh pr checks --watch` 等でバックグラウンド CI 監視を起動すること
