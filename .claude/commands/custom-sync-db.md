カタログ YAML から DB 初期化スクリプトを再生成し、PostgreSQL を再構築します。対象環境: $ARGUMENTS

以下の手順で作業してください：

## 1. 環境の確認

引数 `$ARGUMENTS` を確認し、環境名（`sample` または `production`）を特定してください。
引数がない場合は、`.env` ファイルの `DATA_ENV` の値を使用してください。

## 2. init スクリプトの自動生成

```bash
scripts/generate-init-scripts.sh {ENV}
```

生成結果を確認し、以下を報告してください：
- 生成されたテーブル数
- 生成されたファイルパス

## 3. PostgreSQL の再構築

```bash
scripts/switch-env.sh --force-reload {ENV}
```

## 4. スモークテスト

```bash
scripts/smoke-test.sh
```

## 5. 完了報告

以下の形式で報告してください：

```
## DB 再構築完了

- 環境: {ENV}
- 生成テーブル数: {N}
- スモークテスト: 成功 / 失敗
```
