# Issue #29: document-mcp 統合テストが環境依存で失敗する（sample/production未分離）

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`scripts/switch-env.sh production` で production 環境に切り替えた状態で `scripts/test.sh --integration document-mcp` を実行すると、統合テスト 14 件が全て失敗する。

テストが sample 環境のカタログデータ（`purchase_history`, `customer_master`, `ロイヤルティランク` 等）をハードコードしているため、production 環境では期待値と実データが一致しない。

## 再現手順

1. `scripts/switch-env.sh production`
2. `scripts/test.sh --integration document-mcp`

## 期待する動作

どちらの環境でも統合テストが通る。テストが環境に応じた期待値を使用し、MCP ツールの動作を正しく検証できる。

## 原因

### 根本原因

統合テスト (`catalog-integration.test.ts`, `performance.test.ts`) が sample 環境のカタログデータを文字列リテラルとしてハードコードしている。環境を検出する仕組みや、環境に応じてテストデータを切り替える仕組みが一切存在しない。

### ハードコードされたデータ（主要なもの）

| カテゴリ | ハードコード値 |
|---------|--------------|
| テーブル名 | `purchase_history`, `customer_master` |
| カラム名 | `customer_id`, `amount`, `transaction_date`, `member_code` |
| key_type 値 | `統合会員番号`, `仮会員番号` |
| 統計値 | `avg_basket_size: 3.2`, `top_categories: ["食品", "日用品", "衣料"]` 等 |
| 用語名 | `ロイヤルティランク`, `統合会員ID`, `店舗` |
| ロジック名 | `member_id_remapping`, `sales_basic_aggregation` |
| 最小件数 | テーブル >= 2, 用語 >= 3, ロジック >= 2 |

### 環境間のデータ差

| 項目 | sample | production |
|-----|--------|------------|
| テーブル数 | 2 | 28 |
| 用語数 | 3 | 約180 |
| ロジック数 | 2 | 1 |
| テーブル名 | `purchase_history` 等 | `dm_purchase_history`, `dwh_*` 等 |

## 修正方針

### アプローチ: 環境別テストフィクスチャ

テスト内で現在の環境を検出し、環境に応じたフィクスチャ（期待値セット）を読み込む。

#### 1. 環境検出ヘルパーの追加

`DATA_ENV` 環境変数または `.env` ファイルから現在の環境を取得するヘルパー関数を追加する。

#### 2. フィクスチャ型定義

テストに必要な期待値の型を定義する。全データを網羅するのではなく、各テストケースが必要とするデータのみを含む。

```typescript
interface EnvFixture {
  tables: {
    minCount: number;
    knownName: string;           // インデックスに含まれるテーブル名
    detailTarget: string;        // 詳細テスト対象テーブル
    expectedColumns: string[];   // 期待されるカラム名
    keyTypesTarget?: { ... };    // key_types テスト用
    statisticsTarget?: { ... };  // statistics テスト用
  };
  terms: { ... };
  logic: { ... };
}
```

#### 3. 環境別フィクスチャファイル

- `fixtures/sample.ts` — 現在のハードコード値をそのまま移行
- `fixtures/production.ts` — production カタログから対応する値を設定

#### 4. テストのリファクタリング

ハードコードされた値をフィクスチャ参照に置き換える。テスト構造（describe/it の階層）は変更しない。

#### 5. production 環境での制約

production 環境ではロジックが 1 件のみのため、「ロジック >= 2」の最小件数チェックは環境ごとに適切な値を設定する。また、production カタログに `key_types` や `statistics.additional` を持つテーブルが存在しない場合、該当テストは `describe.skipIf` で条件付きスキップする。

### 影響範囲

- document-mcp のテストコードのみ。プロダクションコード（`src/`）の変更は不要
- 要件定義・API 仕様の変更は不要

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `document-mcp/tests/integration/helpers/env-helper.ts` | **新規作成**: 環境検出ヘルパー (`getDataEnv()`) |
| `document-mcp/tests/integration/fixtures/types.ts` | **新規作成**: フィクスチャ型定義 |
| `document-mcp/tests/integration/fixtures/sample.ts` | **新規作成**: sample 環境フィクスチャ |
| `document-mcp/tests/integration/fixtures/production.ts` | **新規作成**: production 環境フィクスチャ |
| `document-mcp/tests/integration/fixtures/index.ts` | **新規作成**: 環境に応じたフィクスチャ選択・エクスポート |
| `document-mcp/tests/integration/catalog-integration.test.ts` | ハードコード値をフィクスチャ参照に置き換え |
| `document-mcp/tests/integration/performance.test.ts` | ハードコード値をフィクスチャ参照に置き換え |

### テスト計画

1. sample 環境で全統合テストが通ることを確認: `scripts/switch-env.sh sample && scripts/test.sh --integration document-mcp`
2. production 環境で全統合テストが通ることを確認: `scripts/switch-env.sh production && scripts/test.sh --integration document-mcp`
3. 既知障害 `kf-035` を解除する
