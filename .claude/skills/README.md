# Skills

Claude Code が参照する専門知識・実装パターンを格納するディレクトリ。

## 概要

Skills は、繰り返し参照する外部ドキュメントやベストプラクティスを事前に整理したもの。
これにより、毎回ドキュメントを検索する手間を省き、一貫した実装を促進する。

## ディレクトリ構成

```
.claude/skills/
├── README.md                          ← このファイル
│
│  # コンポーネント実装
├── mcp-typescript-server/             ← MCP サーバー構築 + ツール設計パターン
├── error-handling-and-validation/     ← エラーハンドリング・バリデーション・セキュリティ
├── fastapi-rest-server/               ← FastAPI REST サーバー
├── http-api-client-typescript/        ← HTTP API クライアント（axios）
├── testing-strategies/                ← テスト戦略（Vitest / pytest）
│
│  # ドメイン知識
├── jupyter-kernel-communication/      ← Jupyter カーネル通信プロトコル
├── jupyterlab-extension/              ← JupyterLab 4.x 拡張開発
├── yaml-catalog-management/           ← YAML データカタログ管理
│
│  # コマンド共通パターン
├── task-plan-creation/                ← タスク計画作成（調査・テンプレート・レビュー）
├── parallel-investigation/            ← 並列サブエージェント調査テンプレート
└── doc-code-audit/                    ← ドキュメント・コード整合性監査
```

## 現在の Skill 一覧

| Skill | 内容 |
|-------|------|
| `mcp-typescript-server` | MCP サーバー構築 + ツール設計パターン（toolRegistry、3類型テンプレート） |
| `error-handling-and-validation` | エラーハンドリング・入力バリデーション・セキュリティ対策（TypeScript / Python） |
| `fastapi-rest-server` | FastAPI REST サーバーの実装パターン |
| `testing-strategies` | テスト戦略（Vitest / pytest / E2E） |
| `http-api-client-typescript` | axios HTTP クライアントの実装・エラーハンドリング・テストパターン |
| `jupyter-kernel-communication` | Jupyter Server REST API・カーネルプロトコル・AI 同期イベント |
| `jupyterlab-extension` | JupyterLab 4.x フロントエンド拡張の開発パターン |
| `yaml-catalog-management` | データカタログ YAML スキーマと DB 反映フロー |
| `task-plan-creation` | タスク計画作成の共通スキル（調査手順・テンプレート・報告形式） |
| `parallel-investigation` | カスタムコマンドで使う並列サブエージェント調査テンプレート |
| `doc-code-audit` | ドキュメント・コード整合性監査の共通ロジック（audit-docs / auto-audit-docs 用） |

## Skill の追加方法

1. `.claude/skills/{skill-name}/SKILL.md` に内容を記述
2. この README の一覧を更新

## Skill に含めるべき内容

- **概要**: この Skill が何を提供するか
- **実装パターン**: コード例、テンプレート
- **チェックリスト**: 実装時の確認項目

## Rules との使い分け

| 種類 | 用途 | 例 |
|------|------|-----|
| **Rules** | コーディング規約、開発ルール | 命名規則、リビルド必須 |
| **Skills** | 技術・フレームワークの使い方、共通テンプレート | MCP SDK、並列調査パターン |
