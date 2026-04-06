不要なブランチを掃除します。

## 手順

1. まず `--dry-run` で削除対象を確認する：

```bash
scripts/cleanup-merged-branches.sh --all --dry-run
```

2. 結果をユーザーに提示し、削除してよいか確認する

3. 承認されたら実行する：

```bash
scripts/cleanup-merged-branches.sh --all
```

4. 最終的なブランチ一覧（`git branch -a`）を表示して完了を報告する
