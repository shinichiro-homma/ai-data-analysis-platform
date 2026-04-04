# Issue #7: MCP経由のセル追加がディスクに永続化されない（clients > 0時）

## 関連タスク

- タスク番号: Jupyter 2.2（notebook_add_cell ツール実装）、Jupyter 8.1（セル追加のリアルタイム同期）

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

MCP（`notebook_add_cell`）経由でセルを追加した際、ブラウザが JupyterLab に接続中（`clients > 0`）の場合、REST API によるディスク直接書き込みがスキップされる。セルの永続化が SharedModel の自動保存に完全依存し、Docker 再構築後など SharedModel 状態がリセットされる状況ではセルが消失する。

### 問題のコードパス

`jupyter-mcp/src/utils/cell-operations.ts` の `addCellWithSync()`:

```typescript
// AI同期イベントを配信
const eventResult = await jupyterClient.postAiEvent({...});

// clients > 0 の場合、REST API ディスク書き込みをスキップ
if (eventResult.clients === 0) {
  await jupyterClient.operateCell(notebookPath, {...});
}
```

- `clients > 0`: REST API スキップ → SharedModel 依存（ディスク保存は SharedModel の自動保存任せ）
- `clients === 0`: REST API でディスクに直接書き込む

## 再現手順

1. JupyterLab をブラウザで開く（`jupyterlab-ai-sync` が WebSocket 接続 → `clients: 1`）
2. Claude Code（MCP）経由で `notebook_add_cell` でセルを追加
3. `docker exec` でディスク上のノートブックファイルを確認 → **セルが反映されていない**
4. Docker 再構築（`docker-compose down && docker-compose up --build`）
5. ブラウザでノートブックを開く → **追加したセルが消失**

## 再現確認結果

- 再現: **できた**
- 確認方法: Claude Code MCP + curl + docker exec + Playwright
- エビデンス:
  - MCP `notebook_add_cell` 成功後にディスク確認 → セル数 1（空セルのみ、追加したセルなし）
  - `POST /api/ai/events/broadcast` → `{"clients": 1}` 返却（ブラウザ接続中）
  - REST API フォールバックがスキップされていることを確認
  - Playwright でブラウザを開くと SharedModel 経由でセルが表示・自動保存された
  - スクリーンショット: `docs/issues/evidence-notebook-cells-not-persisted.png`

## 期待する動作

MCP 経由でセルを追加した場合、ブラウザの接続状態に関わらず、常にディスク上のノートブックファイルにセルが永続化されること。

## 原因

### 根本原因

`jupyter-mcp/src/utils/cell-operations.ts` 44〜54行目の条件分岐が原因。

```typescript
// ブラウザが接続していない場合のみ REST API でディスクに直接書き込む
if (eventResult.clients === 0) {
  await jupyterClient.operateCell(notebookPath, {...});
}
```

`postAiEvent()` で AI 同期イベントを配信した後、`clients > 0`（ブラウザ接続中）の場合に `operateCell()`（REST API `PATCH /api/custom/contents/{path}/cells`）の呼び出しが完全にスキップされる。ディスクへの永続化が SharedModel の自動保存に完全依存しており、以下のケースでセルが消失する:

- Docker 再構築で SharedModel 状態がリセット
- SharedModel 自動保存の遅延中にコンテナ停止
- ブラウザが WebSocket 接続中だが該当ノートブックを開いていない

### 要件定義の不備

- AC4（受け入れ条件）が「セルが追加される」のみで、永続化保証が明記されていない
- F6.3（リアルタイム同期）と永続化の関係が未定義
- 「リアルタイム配信は UI 表示用であり、永続化の代替ではない」という原則が欠落

## 修正方針

**方針: AI 同期イベントの配信有無に関わらず、常に REST API でディスクに書き込む**

現在の実装は「ブラウザ接続中は SharedModel が保存してくれる」という前提でディスク書き込みをスキップしているが、この前提は不安定。修正後のフローは:

1. AI 同期イベントを配信（ブラウザ UI へのリアルタイム反映用）
2. **常に** REST API でディスクに書き込む（永続化保証）
3. メモリ上のセルカウント・ペンディングセルを更新

これにより、SharedModel の状態に関わらずディスク上にセルが永続化される。

### SharedModel との競合リスク

ブラウザ接続中に REST API とSharedModel の両方がディスクに書き込む可能性があるが:

- REST API はカスタムエンドポイント（`/api/custom/contents/{path}/cells`）でセル単位の操作を行う
- SharedModel は Jupyter の標準保存メカニズムでノートブック全体を保存する
- REST API 書き込み後に SharedModel が保存すれば、両方の変更が統合される
- `clients === 0` の場合は現在も REST API 書き込みが行われており、既存の動作と整合する

### 影響範囲

- **コード変更**: `jupyter-mcp` のみ（1 ファイル）
- **要件定義変更**: 不要（仕様の不備はあるが、「セルが追加される」は「永続化される」を当然含むと解釈できる）
- **API 仕様変更**: 不要（REST API 自体の仕様は変わらない、呼び出し条件が変わるのみ）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/utils/cell-operations.ts` | `if (eventResult.clients === 0)` の条件を削除し、常に `operateCell()` を呼び出す |
| `jupyter-mcp/tests/integration/ai-sync-flow.test.ts` | `clients > 0` 時のディスク永続化テストを追加 |

### テスト計画

1. **既存テストの実行**: `scripts/test.sh jupyter-mcp` で回帰テストを確認
2. **新規テスト追加**: `ai-sync-flow.test.ts` に `clients > 0` 時にもディスクにセルが書き込まれることを検証するテストケースを追加
3. **手動確認**: Docker 環境でブラウザ接続中に MCP 経由でセルを追加し、ディスク上のファイルを確認
