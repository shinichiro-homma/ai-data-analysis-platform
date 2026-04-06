---
paths:
  - "**/*"
---

# アドホックスクリプト実行ルール

開発・デバッグ中に使い捨てスクリプト（検証用コード、API 呼び出しの手動確認等）を実行する場合のルール。

## 原則

**ヒアドキュメント（`<< 'EOF'`）を使ったワンライナーで実行してはならない。**
必ず `tmp/` 配下に一時ファイルを作成してから実行する。

## 理由

1. **開発体験**: heredoc + `&&` + リダイレクト（`2>&1`）の組み合わせは、Claude Code の
   ambiguous syntax 警告を毎回トリガーし、承認プロンプトで開発フローが止まる。
2. **可視性**: `Write` ツールで一時ファイルを作ると、スクリプト内容が差分として見える。
   heredoc の中身はコマンド文字列として埋没し、レビュー性が低い。
3. **再実行性**: ファイル化しておけば、同じ検証を後から繰り返せる。

## 実行手順

1. **ファイル作成**: `Write` ツールで `tmp/adhoc-{用途}.{mjs|py|sh}` に保存する
   - 命名例: `tmp/adhoc-session-create-fail.mjs`, `tmp/adhoc-check-workspace-list.py`
2. **実行**: 単一コマンドで起動する（環境変数は前置で OK）
   ```bash
   JUPYTER_TOKEN=dev-token node tmp/adhoc-session-create-fail.mjs
   ```
3. **後片付け**: 検証が終わったら `tmp/` 配下のファイルを削除する

`tmp/` は `.gitignore` 済みのため、コミット対象にならない。

## 許可される通信先

tmp/ スクリプトからの外向き通信は、以下のホストのみを許可する:

- `localhost`, `127.0.0.1`
- docker-compose 内のサービス名: `jupyter-server`, `document-server`, `postgres`, `jupyter-mcp`, `document-mcp`

**外部インターネット通信は禁止**（npm レジストリ、GitHub API 等を含む）。
これらが必要な場合は、公式の `scripts/` 配下のスクリプトまたは `npm`/`gh` コマンドを使うこと。

## 禁止されるコード

`tmp/` スクリプト内で以下の操作を記述してはならない:

| カテゴリ | パターン例 |
|---------|-----------|
| ファイル/ディレクトリ破壊 | `rm -rf`, `fs.rmSync`, `fs.unlink`, `shutil.rmtree`, `os.remove`, `os.unlink` |
| 外部ダウンロード実行 | `curl ... \| sh`, `wget ... \| bash`, `eval(fetch(...))` |
| 任意コード実行 | `child_process.exec`, `subprocess.*shell=True`, `os.system`, `eval(` |
| 権限昇格 | `sudo`, `chmod 777` |
| 認証情報の外部送信 | `process.env.*TOKEN`, `os.environ[*SECRET*]` を許可リスト外ホストへ送信 |

上記パターンは `.claude/hooks/scan-adhoc-script.sh` が検出し、実行前に**ユーザー承認を求める**。

## 例外手順（誤検知・承認済みケース）

正当な理由で上記パターンを使う必要がある場合:

1. ユーザーに理由を説明し、明示的な承認を得る
2. スキャン hook が `ask` として扱うため、プロンプトで承認すれば実行可能
3. 承認が頻繁に必要なパターンは、一時ファイルではなく `scripts/` 配下の正式スクリプトとして
   実装することを検討する

## 禁止事項

- `node --input-type=module << EOF ... EOF` 形式のワンライナー実行
- `python3 -c "..."` で長文スクリプトを実行すること（数行の一行コマンドはOK）
- `tmp/` 配下のスクリプトをコミットすること
- 本ルールを迂回するためにシェル別名や wrapper 関数を作ること
