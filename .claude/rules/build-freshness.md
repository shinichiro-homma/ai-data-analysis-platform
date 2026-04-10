---
paths:
  - "scripts/rebuild.sh"
  - "scripts/rebuild-mcp.sh"
  - "scripts/check-freshness.sh"
---

# ビルド鮮度保証ルール

コード変更後にテストを実行する際は、**必ず先にリビルドして鮮度を担保する**こと。古いビルド成果物や Docker イメージに対してテストを実行してはならない。

## 推奨フロー

```
コード変更 → scripts/test.sh --rebuild {コンポーネント名}
```

`test.sh --rebuild` は MCP/Docker を自動判定し、STALE なコンポーネントをリビルドしてからテストを実行する。スクリプトの詳細は `.claude/rules/scripts.md` を参照。

> カスタムコマンド（`start-task`, `start-fix`, `refactor`, `complete-task`）では `--rebuild` 付きテストが自動実行されるため、手動リビルドは不要。

## 手動での鮮度チェック

`scripts/check-freshness.sh` で個別チェック可能（`--strict` で exit 1、`--rebuild` で自動リビルド）。

## 禁止事項

- リビルドせずにテストを実行し、その結果を信頼すること
- `scripts/check-freshness.sh` の警告を無視してテストを続行すること
