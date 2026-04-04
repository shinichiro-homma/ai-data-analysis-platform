# ブランチ運用ルール

## ブランチモデル

```
main (公開・リリース済み、直接 push 禁止)
 └── dev (統合・検証用)
      ├── feature/xxx  ← dev から切る
      └── ...
```

## 作業ルール

- **日常の作業は `dev` または `feature/*` ブランチで行う**
- `main` ブランチでは直接コミットしない
- `main` への反映は `scripts/promote-to-main.sh` 経由で PR を作成する

## ブランチ操作

| 操作 | コマンド |
|------|---------|
| 機能開発の開始 | `git checkout dev && git checkout -b feature/xxx` |
| dev への統合 | PR 経由で `feature/xxx` → `dev` にマージ |
| main へのリリース | `scripts/promote-to-main.sh`（dev ブランチで実行） |

## 禁止事項

- `main` ブランチで `git commit` を実行すること（フックでブロックされる）
- `main` ブランチに直接 `git push` すること（GitHub ブランチ保護で拒否される）
