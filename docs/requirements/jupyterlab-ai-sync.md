# jupyterlab-ai-sync 要件定義

> **実装が正**: イベント型の定義とディスパッチ（`handleEvent()`、各 `*Event` 型）は `src/notebook-updater.ts`、WebSocket 接続（接続URL・トークン取得・再接続）は `src/websocket-client.ts` が正。本書はイベントのペイロード形式・型定義をミラーしない。

## 概要

JupyterLabのフロントエンド拡張。AIがノートブックを操作している様子をブラウザ上でリアルタイムに表示し、AI操作中はユーザーの入力を制御する。

## 背景

AIが`execute_code`や`notebook_add_cell`でノートブックを操作しても、JupyterLabのブラウザUIには反映されない。これは、JupyterLabが自身の`execute_request`の`msg_id`と`parent_header.msg_id`を照合してセルに出力を表示する仕組みのため、外部クライアントからの操作は無視される。

本拡張は、jupyter-serverが配信するAI操作イベント（WebSocket）を受信し、JupyterLabの内部APIを使ってノートブックUIを直接更新することで、この問題を解決する。

## アーキテクチャ

```
jupyter-mcp → jupyter-server REST API → カーネル実行 → 結果をAIに返却
                    ↓ (WebSocket イベント配信)
              jupyterlab-ai-sync 拡張 → ノートブックUI更新
                                         ├── notebook_changed → ディスク再読込（context.revert()）
                                         ├── cell_execute_start/end → 実行中表示の制御
                                         └── lock_acquired/released → ロック/アンロック制御
```

## 機能要件

### F1: AI操作イベントの受信

#### F1.1: WebSocket接続
- jupyter-serverの`/api/ai/events` WebSocketエンドポイントに接続する
- 接続が切断された場合、自動的に再接続する
- 認証トークンを使用して接続する

#### F1.2: イベント処理
- AI操作イベント（5 種: `notebook_changed` / `cell_execute_start` / `cell_execute_end` / `lock_acquired` / `lock_released`）を受信し、種別ごとに対応する処理へディスパッチする
- `notebook_changed`（seq 付き）受信時はディスク再読込（`context.revert()`）でノートブックを同期する
- `cell_execute_start` / `cell_execute_end` は ephemeral 通知として実行中表示の制御に使用する
- `lock_acquired` / `lock_released` は jupyter-server のロック API がロック取得・解放・TTL 失効時に配信する
- 受信するイベント種別の一覧・ペイロード形式・ディスパッチは `src/notebook-updater.ts`（`handleEvent()`・`*Event` 型）が正

### F2: ノートブックUIのリアルタイム更新

#### F2.1: ディスク再読込による同期
- `notebook_changed`（seq 付き）イベントを受信したら、`context.revert()` でノートブックをディスクから再読込する
- セル追加・編集・削除・出力永続化などすべての変更が再読込で一括反映される

#### F2.2: セル実行状態の表示
- `cell_execute_start` イベント（ephemeral 通知）を受信したら、対象セルを実行中状態（[*] 表示）にする
- `cell_execute_end` イベント（ephemeral 通知）を受信したら、セルの実行中状態を解除する
- 実行結果（出力・execution_count）は `notebook_changed` による再読込で反映される

### F3: ノートブックロック機能

> ロックの正はサーバー側（jupyter-server）の状態であり、ブラウザの read-only 表示は UX への追従（格下げ）である。ロックそのものはサーバーが書き込み系 API で強制する（不変条件 I2）。

#### F3.1: ロック表示開始
- `lock_acquired`イベント（サーバーがロック取得成功時に配信）を受信したら、対象ノートブックをread-onlyモードにする
- ユーザーのキーボード入力、セル編集、セル実行を無効化する
- ロック中であることを示すUIインジケータを表示する（例: ツールバーにバナー表示）

#### F3.2: ロック表示解除
- `lock_released`イベント（サーバーがロック解放・TTL 失効時に配信）を受信したら、ノートブックのread-onlyモードを解除する
- ユーザーの入力を再度有効化する
- UIインジケータを非表示にする

#### F3.3: ロック中のユーザー体験
- ロック中もノートブックのスクロール・閲覧は可能
- AIが追加したセルや実行結果はリアルタイムに表示される
- ロック理由（「AI が編集中です」等）をユーザーに明示する
- **カーネル中断はロック中でも有効** — ユーザーはAI編集ロック中でもカーネル中断（ツールバー / キーボードショートカット / Kernel メニュー）を実行できる。これは AI が暴走した際の緊急停止手段を確保するため
- **カーネル再起動はロック中は無効化される** — ロック中の再起動はブロックされる。再起動はカーネルプロセスを強制終了して変数・インポート・実行履歴を完全消失させるため、AI 編集中に許可すると `lock_released` 前にカーネル状態が破壊され、以降のツール呼び出しや出力書き戻しが不整合になる

### F4: 対象ノートブックの特定

#### F4.1: パスベースのマッチング
- イベントに含まれる`notebook_path`と、現在開いているノートブックのパスを照合する
- 一致するノートブックが開かれている場合のみ、UI更新を行う

#### F4.2: 未開封ノートブックの処理
- 対象ノートブックがブラウザで開かれていない場合、イベントは無視する

### F5: ファイルブラウザUI改善

#### F5.1: シングルクリックでのフォルダツリー展開
- ファイルブラウザでフォルダをシングルクリックすると、そのフォルダの中身をインライン展開する
- 展開済みのフォルダをシングルクリックすると、折りたたむ
- ツリー展開状態は同一ディレクトリ内で保持される（ディレクトリ変更時にリセット）

#### F5.2: ダブルクリックでのフォルダ移動
- フォルダをダブルクリックすると、そのフォルダに移動し中身のみを表示する（JupyterLab標準動作）

## 非機能要件

### NF1: パフォーマンス

| 項目 | 要件 |
|------|------|
| イベント受信からUI反映 | 100ms以内 |
| WebSocket再接続 | 切断後5秒以内 |

### NF2: 互換性

- JupyterLab 4.x に対応
- 他のJupyterLab拡張と共存可能

### NF3: ユーザー体験

- AIが操作していない時はノートブックの通常動作に影響しない
- ロック中は明確なビジュアルフィードバックを提供する

## 技術仕様

### 技術スタック

- TypeScript
- JupyterLab Extension API (`@jupyterlab/application`, `@jupyterlab/notebook`)
- `@jupyterlab/services`（ServerConnection）
- `@jupyterlab/coreutils`（PageConfig — トークン取得）
- `@jupyterlab/filebrowser`（IDefaultFileBrowser — ファイルブラウザUI操作）
- `@lumino/widgets`（Widget — UIコンポーネント）
- `@jupyter/ydoc`（ISharedCodeCell — セルモデル操作）
- WebSocket（ネイティブブラウザAPI）

### 実装仕様

以下の実装詳細はコードが正とする。具体的な定数値・スキーマ・ロジックはソースコードを参照のこと。

- **WebSocket接続**: 接続URL構築、トークン取得、再接続間隔、切断時動作 → `src/websocket-client.ts`
- **イベントペイロード**: 各イベントタイプの型定義 → `src/websocket-client.ts` のメッセージハンドリング
- **ノートブックパス解決**: 完全一致・サフィックスマッチの2段階マッチング → `src/notebook-finder.ts`, `src/path-utils.ts`
- **セル追加・実行結果反映**: デフォルト空セル置換、trusted設定、SharedModel出力書き戻し → `src/notebook-updater.ts`
- **ロック制御**: 動的セル監視、ロック/アンロック → `src/lock-manager.ts`
- **ロックインジケータUI**: CSSクラス、表示テキスト、アイコン → `src/ui/lock-indicator.ts`, `style/index.css`

> ビルド・インストール手順は `jupyterlab-ai-sync/CLAUDE.md` のコマンドセクションを参照。

## 受け入れ条件

### AC1: ノートブック変更のリアルタイム反映
- [ ] AIが`notebook_add_cell`を呼ぶと、`notebook_changed` 受信 → ディスク再読込でブラウザ上のノートブックにセルが反映される
- [ ] AIが`notebook_edit_cell`や`notebook_delete_cell`を呼んだ場合も同様に再読込で反映される

### AC2: セル実行結果のリアルタイム反映
- [ ] AIが`execute_code`を呼ぶと、`cell_execute_start` で対象セルに [*] が表示される
- [ ] `cell_execute_end` で実行中表示が解除される
- [ ] 実行結果（stdout/stderr/画像/エラー/execution_count）は `notebook_changed` による再読込で反映される

### AC3: ノートブックロック表示
- [ ] `lock_acquired` イベント受信時にノートブックが read-only になる
- [ ] ロック中はキーボード入力・セル編集ができない
- [ ] ロック中であることを示すインジケータが表示される
- [ ] `lock_released` イベント受信時にロック（read-only 表示）が解除される
- [ ] ロック解除後、通常通り編集できる

### AC4: WebSocket接続
- [ ] JupyterLab起動時に自動的にWebSocket接続が確立される
- [ ] 接続が切断された場合、自動的に再接続される

### AC5: ファイルブラウザUI
- [ ] フォルダをシングルクリックすると、そのフォルダの中身がインライン展開される
- [ ] 展開済みフォルダをシングルクリックすると、折りたたまれる
- [ ] フォルダをダブルクリックすると、そのフォルダに移動し中身のみが表示される
- [ ] ディレクトリ変更時（ダブルクリックでフォルダ移動）にツリー展開状態がリセットされる
- [ ] 同一ディレクトリ内でのツリー展開・折りたたみ状態は移動まで保持される
- [ ] ファイルブラウザの既存動作（ファイルのシングルクリック選択、ダブルクリック開く）に影響しない

### AC6: カーネル中断のロック貫通・カーネル再起動のブロック
- [ ] AI編集ロック中でもカーネル中断ボタンが有効である
- [ ] ロック中にキーボードショートカット（`I I`）でカーネル中断が発火する
- [ ] ロック中に中断ボタンをクリックするとカーネルが中断される
- [ ] 中断後もロック/アンロックの状態遷移が正常に動作する
- [ ] AI編集ロック中はカーネル再起動（Kernel メニュー / `0 0` ショートカット / `notebook:restart-kernel` 等のコマンド）が無効化される

## 依存関係

- jupyter-serverのAI同期WebSocketエンドポイント（`/api/ai/events`）が実装されていること
