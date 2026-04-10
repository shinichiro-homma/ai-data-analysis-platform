# ブラウザ操作・UI 検証ガイド

JupyterLab の UI 挙動確認、バグ再現、回帰確認といった「ブラウザを介した検証」を行う際は、**[`@playwright/cli`](https://www.npmjs.com/package/@playwright/cli)** の利用を推奨する。

## なぜ `@playwright/cli` か

このプロジェクトでは、UI 検証は以下の条件を満たす必要がある:

- **再現手順をスクリプト化できる**（Issue 添付・CI 化を見据えて）
- **AI エージェント（Claude Code 等）からも同じ手順で操作できる**
- **コンテキスト消費を抑えられる**（エージェントがスナップショットを逐次読む運用では MCP 版はレスポンスが肥大化しがち）

`@playwright/cli` は Microsoft Playwright チームが公開している CLI 版で、
スナップショットやコンソールログをファイルとして `.playwright-cli/` 配下に保存する設計のため、
上記 3 条件を同時に満たせる。通常の `playwright` スクリプトや `playwright-mcp` と比べて、
人間と AI エージェントが同じコマンド列を共有しやすい点が利点となる。

## セットアップ

### 1. インストール

```bash
# グローバルインストール（初回のみ。sudo が必要になる場合あり）
npm install -g @playwright/cli

# Chromium のダウンロード（初回のみ、約 250MB）
playwright-cli install-browser chromium
```

Firefox / WebKit も必要になった場合は `playwright-cli install-browser firefox` のように追加インストールする。

### 2. Claude Code 用スキルの導入（任意）

Claude Code からこのツールを使う場合、Claude が使い方を理解するためのスキルを導入できる。

```bash
# ユーザーグローバル（全プロジェクトで有効）
cd ~ && playwright-cli install --skills claude

# または、このリポジトリ専用
cd <repo-root> && playwright-cli install --skills claude
```

プロジェクト配下にインストールした場合は `.claude/skills/playwright-cli/` が生成される。
`.gitignore` 済みではないため、コミットするかどうかはチーム方針に従うこと。

## 基本的な使い方

### ブラウザを開く・閉じる

```bash
playwright-cli open http://localhost:8888   # ブラウザセッション起動 + 指定 URL へ遷移
playwright-cli close                         # 現在のセッションを閉じる
playwright-cli close-all                     # すべてのセッションを閉じる
playwright-cli list                          # 起動中のセッション一覧
```

セッションは別プロセスとして永続化されるため、シェルのコマンド間でブラウザ状態が保持される。

### 操作・検証

```bash
playwright-cli snapshot                       # アクセシビリティスナップショットを取得（ref 付き）
playwright-cli click e5                       # ref=e5 の要素をクリック
playwright-cli fill e3 "text" --submit        # 入力 + Enter
playwright-cli screenshot                     # スクリーンショットを取得
playwright-cli console                        # コンソールログを表示
playwright-cli network                        # ネットワークリクエスト一覧
```

要素参照 (`e5` のような ref) は直近の `snapshot` 出力から取得する。

全コマンド一覧は `playwright-cli --help` を参照。

## プロジェクト固有の注意点

### `.playwright-cli/` は `.gitignore` 済み

`playwright-cli` はコマンド実行時のカレントディレクトリに `.playwright-cli/` を作成し、
スナップショット YAML・コンソールログ・スクリーンショット PNG を保存する。
このリポジトリでは `.gitignore` に追加済みのため、誤ってコミットされることはない。

古いファイルが溜まったら手動で削除してよい:

```bash
rm -rf .playwright-cli
```

### JupyterLab のトークン認証

開発環境の JupyterLab はトークン認証が有効なため、URL にトークンを付けて遷移する:

```bash
playwright-cli open "http://localhost:8888/lab?token=${JUPYTER_TOKEN}"
```

`${JUPYTER_TOKEN}` は `.env` で設定した値を使用する。

### アドホックスクリプトとの使い分け

複雑な再現手順（ログイン → ワークスペース作成 → セル実行 → ...）は、
逐次コマンドではなく `.claude/rules/adhoc-script-execution.md` に従って `tmp/adhoc-*.mjs` として
Playwright スクリプトを書いた方が保守しやすい場合もある。
対話的に挙動を探りたい段階では `playwright-cli`、手順が確定したらスクリプト化、という使い分けが目安。

## 参考

- 公式パッケージ: https://www.npmjs.com/package/@playwright/cli
- Playwright MCP（サーバー版。Claude Desktop 等の MCP クライアント向け）: https://github.com/microsoft/playwright-mcp
