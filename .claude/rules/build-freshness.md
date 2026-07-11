---
paths:
  - "scripts/rebuild.sh"
  - "scripts/rebuild-mcp.sh"
  - "scripts/check-freshness.sh"
---

# ビルド鮮度保証ルール

古いビルド成果物や Docker イメージに対して**統合テスト・スモークテスト・動作確認**を実行してはならない。

## 鮮度保証が必要な場面 / 不要な場面

| 場面 | 鮮度保証 |
|------|---------|
| ユニットテスト（`scripts/test.sh`、`--integration` なし） | **不要**（vitest / pytest はソースを直接実行するため、dist / コンテナの鮮度は結果に影響しない） |
| 統合テスト（`scripts/test.sh --integration`）・スモークテスト | **必須** |
| ブラウザ動作確認・Docker 環境での動作確認 | **必須** |

`.claude/hooks/check-before-test.sh` が統合テスト・スモークテストの実行前に鮮度を検証し、古い場合はブロックする（ユニットテストは対象外）。

## 推奨フロー

```
コード変更 → ユニットテスト: scripts/test.sh {コンポーネント名}（リビルド不要）
          → 統合テスト:     scripts/test.sh --integration --rebuild {コンポーネント名}
          → Docker 動作確認: scripts/rebuild.sh {サービス名} 後に確認
```

`test.sh --rebuild` は MCP/Docker を自動判定し、STALE なコンポーネントをリビルドしてからテストを実行する。スクリプトの詳細は `.claude/rules/scripts.md` を参照。

## 手動での鮮度チェック

`scripts/check-freshness.sh` で個別チェック可能（`--strict` で exit 1、`--rebuild` で自動リビルド）。

## 禁止事項

- リビルドせずに**統合テスト・スモークテスト・動作確認**を実行し、その結果を信頼すること
- `scripts/check-freshness.sh` の警告を無視して統合テスト・動作確認を続行すること
- ユニットテストしか実行しない場面で `--rebuild` を付けて不要なビルドを走らせること（`.claude/rules/tdd.md` の「テスト実行コマンドの規律」参照）
