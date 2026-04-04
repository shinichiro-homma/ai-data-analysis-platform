# Issue #26: session_connect の axios シリアライズエラー

## 関連タスク

- タスク番号: なし

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

jupyter-mcp の session-connect 統合テスト全5件で `function transformRequest could not be cloned` エラーが発生し、テストが実行できない。

## 再現手順

1. `scripts/test.sh --integration jupyter-mcp` を実行
2. session-connect.test.ts の全5テストが `DataCloneError` で失敗

## 期待する動作

session-connect 統合テストが正常に実行され、Jupyter サーバーへの接続テストが行われること。

## 原因

### 根本原因

vitest の `pool: 'forks'` 設定と、モジュールスコープの axios インスタンスの組み合わせが原因。

1. **vitest.config.integration.ts**（14行目）で `pool: 'forks'` を使用
   - `child_process.fork()` によるワーカープロセス分岐
   - プロセス間通信に **structured clone アルゴリズム** を使用
2. **jupyter-mcp/src/jupyter-client/client.ts**（69-76行目）で `axios.create()` によりインスタンス生成
   - axios インスタンスは `transformRequest`、`transformResponse` 等の**関数プロパティ**を内包
3. **tests/integration/session-connect.test.ts** が `handleToolCall` を import
   - import チェーン: `tools/index.ts` → `tools/session-connect.ts` → `jupyter-client/client.ts`
   - モジュールスコープの `jupyterClient` シングルトン（axios インスタンス内包）が初期化される
4. vitest がワーカープロセスにモジュール状態を渡す際、**関数は structured clone 不可能** なため `DataCloneError` が発生

### 関連ファイル

| ファイル | 行番号 | 内容 |
|----------|--------|------|
| `jupyter-mcp/vitest.config.integration.ts` | 14 | `pool: 'forks'` 設定 |
| `jupyter-mcp/src/jupyter-client/client.ts` | 69-76 | `axios.create()` によるインスタンス生成 |
| `jupyter-mcp/src/jupyter-client/client.ts` | 578-582 | `jupyterClient` シングルトンの export |
| `jupyter-mcp/tests/integration/session-connect.test.ts` | 10-16 | `handleToolCall` の import |
| `jupyter-mcp/tests/setup.ts` | 1 | `jupyterClient` の直接 import |

## 修正方針

### 方針: テストファイル内の直接 axios 使用を fetch に置き換え

当初は `pool: 'threads'` への変更を予定したが、`threads`/`vmThreads` いずれのプールでも structured clone による RPC 通信は発生するため、pool 変更では解決しないことが判明。

根本原因は、テストファイル `session-connect.test.ts` が `axios` を直接 import し、`createJupyterSession` / `deleteJupyterSession` で `axios.post()` / `axios.delete()` を使用していたこと。テスト実行中に発生する AxiosError（config に transformRequest 等の関数プロパティを内包）が、vitest の RPC レイヤーでシリアライズ不可能となり DataCloneError が発生していた。

修正として、テストの直接 HTTP 呼び出しを Node.js 組み込みの `fetch` API に置き換えた。`fetch` のエラーオブジェクトには関数プロパティが含まれないため、シリアライズ問題が発生しない。vitest 設定（`pool: 'forks'`）は変更不要。

### 影響範囲

- テストファイル1つの修正のみ
- vitest 設定は変更なし（`pool: 'forks'` を維持）
- 要件定義・API仕様の変更は不要
- 他のテストファイルに影響なし

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/tests/integration/session-connect.test.ts` | `import axios` を削除、`createJupyterSession` と `deleteJupyterSession` を `fetch` ベースに書き換え |

### テスト計画

1. session-connect テスト8件が DataCloneError なく実行可能であることを確認
2. エラーケーステスト5件が PASS することを確認
3. ハッピーパステスト3件は別Issue（#25 ワークスペースディレクトリ問題）で失敗するが、DataCloneError ではないことを確認
