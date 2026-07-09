---
name: commit-and-push
description: コミット＆プッシュの共通手順。変更確認・コミットメッセージ作成・commit/push実行をカスタムコマンドから呼び出す際に使用する。
---

# Commit and Push Skill

コミット＆プッシュの共通手順。カスタムコマンドから参照される。

## 手順

### 1. 変更内容の確認

以下を **並列に** 実行する：

- `git status`（未追跡ファイルを含む変更の一覧）
- `git diff`（ステージ済み・未ステージの差分）
- `git log --oneline -5`（直近のコミットメッセージのスタイル確認）

### 2. コミットメッセージの作成

変更内容を分析し、以下の規約に従ってメッセージを作成する。

`.claude/rules/general.md` のコミット規約に従うこと（`style` type も使用可）。

**形式:** `<type>: <subject>`

呼び出し側からコンテキスト（タスク番号、タスク内容等）が渡された場合は、メッセージに反映する。

### 3. コミット & プッシュ

1. 変更対象のファイルを `git add` する（`.env` や認証情報ファイルは除外）
2. `Write` でコミットメッセージを `tmp/commit-msg.txt` に書き出す
3. `git commit -F tmp/commit-msg.txt` でコミットする（`-m` / heredoc は hook がブロックする）
4. `rm tmp/commit-msg.txt` でメッセージファイルを削除する
5. 呼び出し側から `push: true`（デフォルト）が指定されている場合は `git push` を実行する

※ 各コマンドは 1 つずつ別の Bash 呼び出しで実行する（`&&` 連結は hook がブロックする）。

### 4. 報告

以下の形式で結果を返す：

```
- コミット: {コミットメッセージ}
- 変更ファイル: {ファイル数} files
- プッシュ: {完了 / スキップ}
```

## パラメータ

呼び出し側が指定できるパラメータ：

| パラメータ | デフォルト | 説明 |
|-----------|-----------|------|
| `context` | なし | コミットメッセージに含めるコンテキスト（タスク番号等） |
| `push` | `true` | `false` でプッシュをスキップ |
| `agent` | `haiku` | 実行するサブエージェントのモデル。`none` でメインが直接実行 |

## 呼び出し例

### サブエージェント経由（auto-dev, commit）

```
`.claude/skills/commit-and-push/SKILL.md` を読み、その手順に従って commit & push を行ってください。

パラメータ:
- context: タスク {番号} {内容}
- push: true
- agent: haiku
```

### メインで直接実行（complete-task, refactor）

```
`.claude/skills/commit-and-push/SKILL.md` を読み、その手順に従って commit & push を行ってください。

パラメータ:
- context: {コンテキスト}
- push: false
- agent: none
```
