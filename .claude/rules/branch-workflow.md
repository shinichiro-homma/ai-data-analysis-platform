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

- **コード実装は `feature/*` または `fix/*` ブランチで行う**
- `dev` ブランチではドキュメントのみの変更（要件変更、プラン更新等）を直接行ってよい
- `main` ブランチでは直接コミットしない
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する

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

### CI 待機 + dev 切り替え + ブランチ削除

PR 作成後、CI の完了を待ち、dev に切り替えてローカルブランチを削除する。
リモートブランチは GitHub の「PR マージ時に自動削除」設定で削除される。

```bash
# 現在のブランチ名を記録
BRANCH=$(git branch --show-current)

# CI 完了を待機
gh pr checks {PR番号} --watch

# CI パス → dev に切り替え
git checkout dev
git pull origin dev

# ローカルブランチを削除
git branch -d "$BRANCH"
```

CI が失敗した場合はブランチを削除せず、修正を案内する。

バグ修正 PR の場合は、dev 切り替え前に Issue もクローズする：

```bash
gh issue close {Issue番号}
```

### dev への統合

PR 経由で `feature/*` または `fix/*` → `dev` にマージ。

### main へのリリース

`scripts/promote-to-main.sh`（dev ブランチで実行）

## 禁止事項

- `main` ブランチで `git commit` を実行すること（フックでブロックされる）
- `main` ブランチに直接 `git push` すること（GitHub ブランチ保護で拒否される）
- コード実装を `dev` ブランチで直接行うこと（feature/fix ブランチを使う）
