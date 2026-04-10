---
paths:
  - "tmp/**"
---

# アドホックスクリプト実行ルール

開発・デバッグ中の使い捨てスクリプト（検証用コード、API 手動確認等）を実行する場合のルール。

## 原則

**ヒアドキュメント（`<< 'EOF'`）のワンライナー実行は禁止。** 必ず `tmp/` 配下に一時ファイルを作成してから実行する。

## 理由

1. **開発体験**: heredoc + `&&` + `2>&1` の組み合わせは ambiguous syntax 警告で承認プロンプトが止まる
2. **可視性**: `Write` で一時ファイル化すればスクリプトが差分として見える（heredoc 内はレビュー性が低い）
3. **再実行性**: ファイル化しておけば後から同じ検証を繰り返せる

## 実行手順

1. `Write` ツールで `tmp/adhoc-{用途}.{mjs|py|sh}` に保存（例: `tmp/adhoc-session-create-fail.mjs`）
2. 単一コマンドで実行（環境変数は前置 OK）:
   ```bash
   JUPYTER_TOKEN=dev-token node tmp/adhoc-session-create-fail.mjs
   ```
3. 検証後、`tmp/` 配下のファイルを削除する

`tmp/` は `.gitignore` 済みでコミット対象にならない。

## 許可される通信先

tmp/ スクリプトからの外向き通信は、以下のホストのみ許可する:

- `localhost`, `127.0.0.1`
- docker-compose 内のサービス名: `jupyter-server`, `document-server`, `postgres`, `jupyter-mcp`, `document-mcp`

**外部インターネット通信は禁止**（npm レジストリ、GitHub API 等を含む）。必要な場合は `scripts/` 配下の正式スクリプトまたは `npm`/`gh` コマンドを使う。

## 禁止されるコード

`tmp/` スクリプト内で以下を記述してはならない。`.claude/hooks/scan-adhoc-script.sh` が検出し実行前にユーザー承認を求める。

| カテゴリ | パターン例 |
|---------|-----------|
| ファイル/ディレクトリ破壊 | `rm -rf`, `fs.rmSync`, `fs.unlink`, `shutil.rmtree`, `os.remove`, `os.unlink` |
| 外部ダウンロード実行 | `curl ... \| sh`, `wget ... \| bash`, `eval(fetch(...))` |
| 任意コード実行 | `child_process.exec`, `subprocess.*shell=True`, `os.system`, `eval(` |
| 権限昇格 | `sudo`, `chmod 777` |
| 認証情報の外部送信 | `process.env.*TOKEN`, `os.environ[*SECRET*]` を許可リスト外ホストへ送信 |

## 例外手順

正当な理由で上記パターンを使う場合は、ユーザーに理由を説明して明示的な承認を得る（hook が `ask` として扱うため、プロンプトで承認すれば実行可能）。承認が頻繁に必要なら `scripts/` 配下の正式スクリプト化を検討する。

また、`node --input-type=module << EOF ... EOF` 形式のワンライナーや、`python3 -c "..."` での長文スクリプト（数行なら OK）、`tmp/` 配下のコミット、本ルールを迂回する別名・wrapper 関数は禁止する。
