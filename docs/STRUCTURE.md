# ドキュメント構成マップ

要件・仕様を変更する際は、以下の依存関係に基づいて関連ファイルを更新すること。

## 大原則: コードが正（Single Source of Truth）

実装の詳細（ツール/APIの入出力スキーマ、パラメータ、デフォルト値、エラーコード等）は**ソースコードが正**であり、ドキュメントには記載しない。ドキュメントが持つのは「コードから読み取れない情報」（Why、機能分類、受け入れ条件、未実装要件）と、コードとの対応を保つための**最小限の一覧表**（CI で自動照合される）のみ。判定基準は `.claude/rules/documentation.md` を参照。

## ファイル一覧と役割

```
CLAUDE.md                           ← 全体概要（コンポーネント表、開発ドキュメントへのリンク）
README.md                           ← GitHub 向け README（概要、セットアップ）
│
├── .claude/
│   ├── agents/                    ← サブエージェント定義
│   ├── commands/                   ← カスタムコマンド
│   ├── hooks/                      ← フック（PreToolUse / PostToolUse）
│   ├── rules/                      ← 開発ルール
│   └── skills/                     ← 専門知識・実装パターン
│
├── docs/
│   ├── overview.md                 ← 全体像、アーキテクチャ、ユースケースフロー、データフロー
│   ├── STRUCTURE.md                ← このファイル（ドキュメント構成マップ、更新の依存関係）
│   │
│   ├── requirements/               ← 各コンポーネントの要件定義（F番号・Why・受け入れ条件）
│   │   ├── jupyter-server.md
│   │   ├── jupyter-mcp.md
│   │   ├── jupyterlab-ai-sync.md
│   │   ├── document-server.md
│   │   └── document-mcp.md
│   │
│   ├── adr/                        ← 設計判断の記録（ADR。書く契機は adr/README.md）
│   │
│   ├── design/
│   │   ├── api-contracts.md        ← REST API のエンドポイント一覧（詳細はコード）
│   │   └── invariants.md           ← 横断不変条件（全レビュー・計画の共通観点）
│   │
│   ├── plan/                       ← 開発タスク一覧（進行中・未着手のみ）
│   │   ├── README.md               ← インデックス、アーカイブ規約
│   │   ├── 01-jupyter.md 〜 04-infrastructure.md
│   │   └── archive/                ← 完了 Phase の記録
│   │
│   ├── tasks/                      ← タスクごとの詳細な開発計画（現役のみ）
│   │   └── archive/                ← 完了タスクの詳細計画
│   │
│   ├── issues/                     ← 未解決の既知バグ・Issue 詳細
│   │   └── archive/                ← 解決済み Issue
│   │
│   ├── guides/                     ← 運用ガイド
│   └── PLAN.md                     ← リダイレクト（→ plan/README.md）
│
├── scripts/                        ← ビルド・テスト・運用スクリプト（.claude/rules/scripts.md）
│
└── {component}/CLAUDE.md           ← コンポーネント概要、コマンド、環境変数、コードへのポインタ
```

## Single Source of Truth（正）の定義

| 情報 | 正 | サマリー/参照を置いてよい場所 |
|------|-----|------------------------------|
| ツール/APIの入出力スキーマ・パラメータ・デフォルト値・エラーコード | **コード**（`jupyter-mcp/src/tools/`, `document-mcp/src/tools/`, `document-server/src/`, `jupyter-server/extensions/`） | なし（ドキュメントはコードへのポインタのみ） |
| MCPツールの一覧（名前と目的） | `docs/requirements/*-mcp.md` の「ツール一覧」表（**CI がコードと照合**） | — |
| REST API エンドポイントの一覧（メソッド・パス・目的） | `docs/design/api-contracts.md` の一覧表（**CI がコードと照合**） | — |
| 機能要件（F番号・Why・受け入れ条件・未実装要件） | `docs/requirements/*.md` | `docs/overview.md`（責務レベルの要約） |
| コンポーネント横断の設計判断（状態の所有権・契約・方式選定の Why） | `docs/adr/` | `docs/tasks/`（タスク内に閉じる判断のみ） |
| 横断不変条件（システム全体で守る性質） | `docs/design/invariants.md` | — |
| 技術スタック | `docs/requirements/*.md` | `*/CLAUDE.md`（簡易版） |
| 開発コマンド | `*/CLAUDE.md` | — |
| 環境変数 | `*/CLAUDE.md` | `docs/requirements/*.md`（要件としての説明のみ） |
| アーキテクチャ図 | `docs/overview.md` | `README.md`（リンク参照のみ） |
| コンポーネント表 | `CLAUDE.md` | `README.md`（同一内容を意図的に二重管理: 外部公開用） |

## 更新の依存関係

| 変更内容 | 更新が必要なファイル |
|----------|---------------------|
| **MCPツールの追加・削除・改名** | コード（正） → `docs/requirements/{component}-mcp.md` のツール一覧表（名前と目的の行を追加/削除。CI が同期を検証） |
| **REST APIの追加・削除・パス変更** | コード（正） → `docs/design/api-contracts.md` のエンドポイント一覧表（CI が同期を検証） |
| **パラメータ・スキーマ・デフォルト値・エラーコードの変更** | コードのみ（ドキュメント更新不要） |
| **要件の変更（機能追加・仕様変更）** | `.claude/rules/requirement-workflow.md` に従う: `docs/requirements/*.md` → 必要に応じて `docs/overview.md` → `docs/plan/`（タスク追加） |
| **アーキテクチャ変更** | `docs/adr/`（判断の記録） → `docs/overview.md` → 影響する `requirements/*.md` → 影響する `*/CLAUDE.md` → `CLAUDE.md` / `README.md`（該当すれば） |
| **新コンポーネント追加** | `CLAUDE.md` → `README.md` → `docs/overview.md` → `docs/requirements/{new}.md`（新規） → `{new}/CLAUDE.md`（新規） → `docs/plan/` |
| **開発タスクの追加・変更・完了** | `docs/plan/` 内の該当ファイル（完了時は `docs/plan/README.md` のアーカイブ規約に従う） |

## CI による整合性検証

`scripts/check-docs-consistency.py`（CI: doc-consistency ジョブ）が PR ごとに以下を機械的に検証する。

1. **MCPツール名の同期** — コードに登録されたツール名と `docs/requirements/*-mcp.md` のツール一覧表が一致すること
2. **REST エンドポイントの同期** — コードのルート定義と `docs/design/api-contracts.md` の一覧表が一致すること
3. **Markdown リンク** — `docs/` 配下・ルートの `*.md` の相対リンクが切れていないこと

このため、ツール一覧表・エンドポイント一覧表は以下の形式を守ること:

- ツール一覧表: `## ツール一覧` セクション配下の表。1列目がバッククォート付きツール名（例: `` `execute_code` ``）
- エンドポイント一覧表: コンポーネントごとのセクション配下の表。`| メソッド | パス | 目的 |` 形式

意味レベルの乖離（説明文とロジックの不一致等）は CI では検知できないため、`/custom-audit-docs`（`.claude/skills/doc-code-audit/SKILL.md`）と `/custom-complete-task` 内の整合性チェックで検査する。

## 各ファイルの更新ポイント

### CLAUDE.md（ルート）
- コンポーネント表（名前、概要、ポート）。新コンポーネント追加時に更新

### README.md
- コンポーネント表、セットアップ手順、アーキテクチャ図へのリンク。ツール/API の詳細一覧は持たない（コードと requirements へのポインタのみ）

### docs/overview.md
- アーキテクチャ図、ユースケースフロー、コンポーネント詳細（責務のみ。技術スタック・ツール一覧は含めない）、データフロー、非機能要件

### docs/requirements/*.md
- 機能要件（F番号、Why、受け入れ条件）、非機能要件、未実装の将来要件（ステータス明記）
- MCPコンポーネントは「ツール一覧」表（名前・対応F番号・1行の目的。**CI 照合対象**）
- 入出力スキーマ・デフォルト値等の実装詳細は書かない（コードが正）

### docs/design/api-contracts.md
- コンポーネント別のエンドポイント一覧表（メソッド・パス・目的。**CI 照合対象**）
- コンポーネント間の契約に関する設計方針（認証方式、エラーレスポンスの共通形式の考え方等、Why レベルのみ）
- リクエスト/レスポンスの詳細スキーマは書かない（コードが正）

### */CLAUDE.md（各コンポーネント）
- コンポーネント概要、コマンド一覧、環境変数
- ツール/API はコード内の定義場所へのポインタのみ（一覧は持たない）

### docs/plan/（開発プラン）
- 進行中・未着手タスクのみ。完了分は `archive/` へ（規約は `plan/README.md`）
