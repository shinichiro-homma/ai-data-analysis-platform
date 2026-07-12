---
name: testing-strategies
description: Vitest（TypeScript）・pytest（Python）・E2Eテストの実装パターンとテンプレート。テスト作成・拡充時に使用する。
---

# Testing Strategies

## 概要

このプロジェクトにおけるテスト実装のガイド。Vitest (TypeScript)、pytest (Python)、E2E テストの3つのフレームワークを横断的にカバーする。テスト実装時はこのドキュメントのパターンとテンプレートに従うこと。

## テストフレームワーク一覧

| フレームワーク | 対象コンポーネント | 用途 |
|---------------|-------------------|------|
| Vitest (TypeScript) | jupyter-mcp, document-mcp | MCP ツールのユニットテスト、結合テスト |
| pytest (Python) | document-server, jupyter-server | REST API のユニットテスト、Router テスト（document-server）／クラスベース命名・重い依存モックでのカスタム拡張テスト（jupyter-server） |
| Vitest (E2E) | tests/e2e/ | docker compose 上の全サービス横断テスト |

## テスト構造の原則

テスト構造・命名・カバレッジの原則は `.claude/rules/testing.md` に定義されている。
本スキルではフレームワーク固有のテンプレートと設定パターンのみを示す。

## どのリファレンスを読むか

実装対象に応じて、以下のリファレンスファイルを読むこと。すべてを読む必要はない。

| ファイル | 内容 | 読むタイミング |
|---------|------|----------------|
| `reference/vitest-mcp-testing.md` | jupyter-mcp / document-mcp のユニットテスト、モックパターン、エラーケース網羅、Vitest 設定の使い分け | MCP ツールのユニットテストを書く／拡充するとき |
| `reference/pytest-testing.md` | document-server の pytest 構成・conftest.py フィクスチャパターン・Router テストテンプレート／jupyter-server の conftest.py によるモックロード・クラスベース命名・async テストパターン | document-server の REST API テスト、または jupyter-server のカスタム拡張テストを書くとき |
| `reference/e2e-testing.md` | tests/e2e/ の構成、API クライアントヘルパー、シナリオベース・パフォーマンステストのパターン | docker compose 環境全体を横断する E2E テストを書くとき |
| `reference/integration-testing.md` | TypeScript の結合テスト（実サーバー接続）の構造・前提条件 | jupyter-mcp/document-mcp の結合テスト（Docker必要）を書くとき |

---

## チェックリスト

テスト作成時に以下を確認すること。

### 構造

- [ ] `describe` で機能単位をグルーピングしているか
- [ ] `正常系`、`バリデーションエラー`、`API エラー` のカテゴリに分けているか
- [ ] テスト名が日本語で意図を明示しているか（例: `正常系: 単一テーブル指定で詳細が取得できる`）
- [ ] Arrange-Act-Assert パターンに従っているか

### カバレッジ

- [ ] 基本的な成功パターンをテストしているか
- [ ] オプションパラメータあり/なしの両方をテストしているか
- [ ] 必須パラメータ未指定のバリデーションをテストしているか
- [ ] 空文字列のバリデーションをテストしているか
- [ ] 文字列長超過のバリデーションをテストしているか
- [ ] NULLバイト含有のバリデーションをテストしているか（該当する場合）
- [ ] パストラバーサル（`..`）のバリデーションをテストしているか（パス系パラメータの場合）
- [ ] API 接続エラー時の動作をテストしているか
- [ ] リソース未発見時の動作をテストしているか
- [ ] 部分成功（一部 not_found）のケースをテストしているか（一括取得 API の場合）

### モック

- [ ] `vi.mock()` はファイルトップレベルに配置しているか
- [ ] `beforeEach` で `vi.clearAllMocks()` を呼んでいるか
- [ ] モックは振る舞いレベルで行い、実装詳細に依存していないか
- [ ] 外部 API 呼び出しが `not.toHaveBeenCalled()` でガードされているか（バリデーションエラー時）

### クリーンアップ

- [ ] 結合テストで作成したリソース（セッション、ワークスペース、ノートブック）を `afterEach` で削除しているか
- [ ] E2E テストでクリーンアップ用の状態変数を管理しているか
- [ ] クリーンアップの失敗は無視して他テストに影響させない設計か

### E2E テスト固有

- [ ] `checkServices()` でサービス起動確認を行っているか
- [ ] サービス未起動時にテストをスキップする仕組みがあるか
- [ ] タイムアウト値が適切に設定されているか（E2E: 60s、結合: 30s、ユニット: 5s）
