# タスク詳細: Phase 22 jupyter-mcp 構造改善

## 概要

jupyter-mcp の3つの構造的問題を解消し、Phase 21（AI 同期再設計）の実装基盤を整備する。

1. **22.1**: notebook 編集系7ツールのコピペコードを共通ヘルパー `operateCellWithSync` に縮約（I8 違反の解消）
2. **22.2**: `client.ts` の `request<T>` における API レスポンスの無検証キャストを zod 境界検証に置換（I4 違反の解消）
3. **22.3**: `index.ts`（844行）のツール定義を各ツールファイルへ分散し、index は組み立てのみにする

実施順は 22.1 → 22.3 → 22.2（22.1 で execute 関数を縮約してから 22.3 で定義を移動するのが差分最小。22.2 は client.ts のみで独立）。

## 関連ドキュメント

- 要件定義: `docs/requirements/jupyter-mcp.md` の F3.2（セル操作）、F6.1（AI編集制御）、F6.3（リアルタイム同期）
- API仕様: `docs/design/api-contracts.md` の `PATCH /api/custom/contents/{path}/cells`
- 不変条件: `docs/design/invariants.md` の I4（境界でランタイム検証）、I8（rule of three）
- ADR: `docs/adr/0002-ai-sync-notify-reload.md`（Phase 21 の前提整備として本タスクを実施）
- 調査原文: `tmp/refactor-notes.md` §5

## 調査したファイル

- `jupyter-mcp/src/tools/notebook-edit-cell.ts`: 編集系ツールの典型例（72行）。パス検証 → インデックス検証 → operateCell → postAiEvent → 成功レスポンス → エラーハンドリングの6段パターン
- `jupyter-mcp/src/tools/notebook-delete-cell.ts`: edit-cell と同構造。差分は action='delete' とイベント type='cell_deleted' のみ
- `jupyter-mcp/src/tools/notebook-reorder-cell.ts`: to_index パラメータが追加される以外は同構造
- `jupyter-mcp/src/tools/notebook-merge-cells.ts`: start_index + end_index の2パラメータ。同構造
- `jupyter-mcp/src/tools/notebook-copy-cell.ts`: target_index 省略時のデフォルト計算ロジックあり
- `jupyter-mcp/src/tools/notebook-split-cell.ts`: split_line に validatePositiveIntegerParam を使用
- `jupyter-mcp/src/tools/notebook-change-cell-type.ts`: new_type の enum 手動チェック（validateCellIndexParam 系を使わず直書き）
- `jupyter-mcp/src/utils/cell-operations.ts`: `addCellWithSync` ヘルパー（共通化の先行例。postAiEvent → operateCell → セルトラッカー更新の順）
- `jupyter-mcp/src/jupyter-client/client.ts:575-593`: `request<T>` private メソッド。`axios.request<T>()` の戻り値を無検証で T として返却
- `jupyter-mcp/src/jupyter-client/types.ts`: API レスポンス型の interface 定義（ApiResponse<T>、Cell、ExecuteResult 等）。zod 未使用
- `jupyter-mcp/src/tools/index.ts`: toolRegistry 配列（52-803行）に definition + execute を23エントリ定義（844行）。NOTEBOOK_EDIT_TOOLS Set（807-820行）。handleToolCall ミドルウェア（833-844行）
- `packages/mcp-shared/src/tool-router.ts`: `ToolEntry<TResult>` = `{ definition: Tool, execute: fn }`。sharedRegisterTools / sharedHandleToolCall を jupyter-mcp と document-mcp が共用
- `jupyter-mcp/tests/unit/tools/notebook-edit-cell.test.ts`: vi.mock で jupyterClient をモック。正常系 / バリデーション異常系 / API エラー異常系の3ブロック構成
- `jupyter-mcp/tests/unit/tools/index.test.ts`: 全ツールをスタブ化し、ルーティングと NOTEBOOK_EDIT_TOOLS 判定を検証
- `jupyter-mcp/package.json`: zod 未依存（devDependencies にも無し）

## 検討した代替案

### 22.1 operateCellWithSync 共通化

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | ヘルパー関数 `operateCellWithSync` を `utils/cell-operations.ts` に追加。各ツールは固有パラメータの検証と操作定義のみに縮約 | 既存の `addCellWithSync` と同じパターンで一貫性あり。テストはヘルパー単体 + 各ツールの薄いラッパーの2層で分離 | 各ツールのシグネチャが変わるためテストの修正が必要 |
| B | 宣言的な設定オブジェクト（action, eventType, params 定義）＋ジェネリック executor | ツール追加時の記述量がさらに少ない | 過剰抽象。パラメータ検証のバリエーション（copy-cell のデフォルト計算、change-cell-type の enum チェック）を宣言的に表現するとかえって複雑化 |

採用理由: A は既存パターン（`addCellWithSync`）の延長で学習コストが低く、ツールごとの個別ロジック（copy-cell のデフォルト計算等）も自然に収まる。Phase 21.3 で postAiEvent を notebook_changed に置換する際も、ヘルパー1箇所の変更で済む。

### 22.2 zod 境界検証

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | `client.ts` の各 public メソッドの戻り値を zod で検証。スキーマは `jupyter-client/schemas.ts` に集約 | 検証箇所がプロセス境界（client メソッド）に集中し I4 に合致。`request<T>` の private 性を維持 | 各メソッドに `.parse()` 呼び出しを追加（約30メソッド） |
| B | `request<T>` にオプション引数で zod スキーマを渡す | 検証ロジックが1箇所に集約 | `request<T>` のシグネチャが複雑化。スキーマ型パラメータの推論が axios の型パラメータと競合しうる |

採用理由: A は I4 の「境界で検証」の原則に忠実で、各メソッドの戻り値型がスキーマから推論される。B は request のジェネリクスが複雑化し、スキーマを渡さないパスが型安全にならない。ただし、全30メソッドを一括で変更するのは大きいため、**本タスクではデータを返すメソッド（`getContents`, `postAiEvent`, `executeCode`, `listSessions` 等）に限定**し、残りは後続タスクで段階的に追加する。`operateCell` 等の `Promise<void>` メソッドは戻り値を使わないため対象外。

### 22.3 ツール定義分散

| 案 | 概要 | 利点 | 欠点 |
|----|------|------|------|
| A（採用） | 各ツールファイルが `toolEntry: ToolEntry<McpToolResult>` を export し、index.ts は import + 配列組み立て + ミドルウェアのみ | definition と execute が同一ファイルに並び、変更時の見落としが減る。21.1 で `JupyterToolEntry` に差し替える際も各ファイル内で完結 | import 文が増える（ただし現状も execute の import が30行あるため実質同等） |
| B | `definitions/` ディレクトリを新設し、定義だけ分離 | 定義と実装の関心が分離 | ファイル数が倍増。定義と実装が離れることで不整合リスクが上がる |

採用理由: A は MCP Skill 推奨の toolRegistry パターンに沿い、Phase 21.1 で `mutatesNotebook` を追加する際にも自然に対応できる。

ADR 要否: 不要（refactor-notes §5 で方針は確立済み。コンポーネント間契約や状態の所有権を変える変更ではない）

## 参考にする既存実装

- `jupyter-mcp/src/utils/cell-operations.ts` の `addCellWithSync`: operateCellWithSync ヘルパーの先行パターン。ただし addCellWithSync は postAiEvent → operateCell（逆順）+ セルトラッカー更新を含むため、operateCellWithSync は operateCell → postAiEvent（正順）の単純化版にする
- 編集系7ツールのコピペ（I8 違反、7回目のコピー。本タスクで共通化）

## 異常系・不変条件

- 該当する異常系（不正入力）: zod 検証失敗時に「形式不正」エラーとして返すこと。jupyter-server の API が予期しない形式のレスポンスを返した場合、キャスト由来の undefined エラーではなく zod の `RESPONSE_VALIDATION_ERROR` が発生することを検証
- 関係する不変条件:
  - I4（境界でランタイム検証）: zod 検証の導入で充足。検証失敗のテストで担保
  - I8（rule of three）: 7ツール → 1ヘルパー + 7薄ラッパーで解消

## 実装計画

### 変更するファイル

| ファイル | 内容 |
|----------|------|
| `jupyter-mcp/src/utils/cell-operations.ts`（変更） | `operateCellWithSync` ヘルパー関数を追加 |
| `jupyter-mcp/src/tools/notebook-edit-cell.ts` 他6ファイル（変更） | ヘルパー呼び出しに縮約 |
| `jupyter-mcp/src/tools/index.ts`（変更） | definition を各ツールファイルへ移動し、import + 配列組み立てのみに縮約 |
| `jupyter-mcp/src/tools/*.ts` 全31ファイル（変更） | `toolEntry` を export（definition + execute のペア） |
| `jupyter-mcp/src/jupyter-client/schemas.ts`（新規） | zod スキーマ定義（API レスポンス型） |
| `jupyter-mcp/src/jupyter-client/client.ts`（変更） | データを返す public メソッドの戻り値に zod 検証を追加（対象: `getContents`, `postAiEvent`, `executeCode`, `listSessions` 等。`operateCell` 等の void 戻りメソッドは対象外） |
| `jupyter-mcp/tests/unit/tools/notebook-edit-cell.test.ts` 他6ファイル（変更） | ヘルパーのモック構成に変更 |
| `jupyter-mcp/tests/unit/jupyter-client/client.test.ts`（変更） | zod 検証追加後のメソッドの既存テスト整合確認 |
| `jupyter-mcp/tests/unit/utils/cell-operations.test.ts`（新規 or 変更） | operateCellWithSync のユニットテスト |
| `jupyter-mcp/tests/unit/jupyter-client/schemas.test.ts`（新規） | zod スキーマのバリデーションテスト |
| `jupyter-mcp/package.json`（変更） | zod を dependencies に追加 |

### 実装手順

#### Step 1: operateCellWithSync ヘルパー作成（22.1）

1. `jupyter-mcp/src/utils/cell-operations.ts` に `operateCellWithSync` 関数を追加する。引数: `notebookPath: string`, `operation: CellOperationRequest`, `event: AiEvent`, `successPayload: Record<string, unknown>`。内部で `jupyterClient.operateCell()` → `jupyterClient.postAiEvent()` → `createSuccessResponse()` を実行する。検証: `scripts/test.sh jupyter-mcp --typecheck` が成功する

2. `notebook-edit-cell.ts` を operateCellWithSync 呼び出しに書き換える。検証: `scripts/test.sh jupyter-mcp` で `notebook-edit-cell.test.ts` が成功する

3. 残り6ツール（delete, reorder, merge, copy, split, change-type）を同様に書き換える。copy-cell のデフォルト計算と change-cell-type の enum チェックはツールファイル内に残す。検証: `scripts/test.sh jupyter-mcp` で全テストが成功する

4. `operateCellWithSync` のユニットテストを作成する（正常系: operateCell と postAiEvent が期待引数で呼ばれる / 異常系: operateCell 失敗時にエラーレスポンスが返る）。検証: `scripts/test.sh jupyter-mcp` で新規テストが成功する

#### Step 2: ツール定義分散（22.3）

5. `notebook-edit-cell.ts` に `toolEntry` を export する（definition を index.ts から移動 + execute を含むオブジェクト）。index.ts 側は `import { toolEntry as notebookEditCellEntry } from './notebook-edit-cell.js'` に変更。検証: `scripts/test.sh jupyter-mcp` が成功する

6. 残り全ツールファイル（30ファイル）に同様に toolEntry を export し、index.ts から definition を移動する。検証: `scripts/test.sh jupyter-mcp` が成功する

7. index.ts を整理する: toolRegistry は各ファイルからの import を配列化するだけにし、NOTEBOOK_EDIT_TOOLS / registerTools / handleToolCall は維持する。検証: `wc -l jupyter-mcp/src/tools/index.ts` が 100 行以下

#### Step 3: zod 境界検証（22.2）

8. `zod` を jupyter-mcp の dependencies に追加する。検証: `npm ls zod --prefix jupyter-mcp` で zod が表示される

9. `jupyter-mcp/src/jupyter-client/schemas.ts` を作成する。`types.ts` の interface に対応する zod スキーマを定義する（対象: `ApiResponse`, `ApiError`, `NotebookResponse`, `BroadcastEventResponse`, `ExecuteResult`, `JupyterSession` 等、データを返すメソッドの戻り値型）。検証: `scripts/test.sh jupyter-mcp --typecheck` が成功する

10. `client.ts` のデータを返す public メソッド（`getContents`, `postAiEvent`, `executeCode`, `listSessions` 等）の戻り値を zod スキーマで検証するように変更する。`operateCell` 等の `Promise<void>` メソッドは対象外。検証失敗時は `JupyterClientError` を投げる（code: 'RESPONSE_VALIDATION_ERROR'）。既存の `client.test.ts` が成功することを確認する。検証: `scripts/test.sh jupyter-mcp` が成功する

11. zod スキーマのテストを作成する（正常系: 正しいレスポンスがパースできる / 異常系: 不正なレスポンスで ZodError が発生する）。検証: `scripts/test.sh jupyter-mcp` で新規テストが成功する

### 技術的な考慮事項

- `operateCellWithSync` は `addCellWithSync` と異なり、セルトラッカー更新を含まない（edit/delete/reorder 等はセル数を変えないか、サーバー側で管理されるため）
- copy-cell の `target_index` デフォルト計算は `operateCellWithSync` に含めず、ツールファイル内のパラメータ準備段階に残す（特殊ロジックをヘルパーに入れると汎用性が下がる）
- change-cell-type の enum チェック（`new_type` が 'code' / 'markdown' のいずれか）も同様にツール固有ロジックとして残す
- zod スキーマは `types.ts` の interface と二重管理になるが、I4 の「ランタイム検証」を実現するために必要。将来的には zod スキーマから型を `z.infer<>` で導出して interface を廃止できるが、本タスクのスコープ外
- Phase 21.3 で postAiEvent のイベント種別が `notebook_changed` に統一されるため、`operateCellWithSync` 内の postAiEvent 呼び出しは 21.3 で変更対象になる。ヘルパーに集約済みのため変更は1箇所で済む
- toolEntry の export 名は全ツールで `toolEntry` に統一する。index.ts での import 時に `as {ToolName}Entry` でリネームする
- `WORKSPACE_STATUS_SCHEMA`（index.ts:16-19）は workspace_create と workspace_update の definition で共用されている。定義分散時は `utils/validation.ts`（`VALID_WORKSPACE_STATUSES` の定義元）にスキーマ定数を移動し、両 workspace ツールファイルから import する

## リスクと検知方法

- operateCellWithSync の抽象化で個別ツールの固有ロジックが欠落する: 7ツールの既存ユニットテスト（各テスト正常系 + 異常系）が全件成功することで検知
- ツール定義移動時の definition / execute の不一致: 既存の `tests/unit/tools/index.test.ts`（ルーティングテスト）が全件成功することで検知
- zod スキーマと実際の API レスポンスの乖離: 統合テスト（`scripts/test.sh jupyter-mcp --integration`）で実 API レスポンスが検証を通ることで検知
- document-mcp への影響: mcp-shared は変更しないため構造的に影響なし。`scripts/test.sh document-mcp` の成功で確認

## 完了条件

- [ ] `scripts/test.sh jupyter-mcp` が lint・型チェック・ユニットテスト込みで成功する
- [ ] 7つの編集系ツールファイル（edit/delete/reorder/merge/copy/split/change-type）が `operateCellWithSync` を使用している: `grep -l 'operateCellWithSync' jupyter-mcp/src/tools/notebook-*.ts` が7件
- [ ] `wc -l jupyter-mcp/src/tools/index.ts` が 100 行以下（現在 845 行から大幅縮小）
- [ ] 各ツールファイルが `toolEntry` を export している: `grep -l 'export.*toolEntry' jupyter-mcp/src/tools/*.ts` が 31 件（index.ts を除く全ツールファイル）
- [ ] `jupyter-mcp/src/jupyter-client/schemas.ts` が存在し、データ返却メソッド用の zod スキーマが定義されている
- [ ] （異常系）`client.ts` のデータ返却メソッド（`getContents` 等）が不正形式のレスポンスを受け取ると `RESPONSE_VALIDATION_ERROR` コードの JupyterClientError を投げる: テストで検証
- [ ] `scripts/test.sh document-mcp` が成功する（共有型への非影響確認）

## テスト計画

- ユニット:
  - `operateCellWithSync` のテスト（正常系: API 呼び出し + イベント配信 / 異常系: API エラー時のレスポンス）
  - 7ツールの既存テストが全件成功すること（リグレッション防止）
  - `addCellWithSync` を使う `notebook-add-cell.test.ts` と `execute-code.test.ts` が成功すること（cell-operations.ts 変更の非影響確認）
  - zod スキーマのテスト（正常系: 正しいデータのパース / 異常系: 不正データのバリデーションエラー）
  - `client.test.ts` の既存テストが成功すること（zod 追加の非影響確認）
  - `index.test.ts` のルーティングテストが成功すること
  - Step 7 の index.ts 整理後に `registerTools` / `handleToolCall` の export が維持されていること（`server.ts` が import するため）
- 統合: `scripts/test.sh jupyter-mcp --integration` で実 API レスポンスが zod 検証を通ること

---

## レビューステータス

- [x] 計画レビュー完了
- [ ] 実装完了
- [ ] テスト完了
