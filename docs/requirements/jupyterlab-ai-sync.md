# jupyterlab-ai-sync 要件定義

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
                                         ├── セル追加
                                         ├── 実行結果表示（outputs設定）
                                         └── ロック/アンロック制御
```

## 機能要件

### F1: AI操作イベントの受信

#### F1.1: WebSocket接続
- jupyter-serverの`/api/ai/events` WebSocketエンドポイントに接続する
- 接続が切断された場合、自動的に再接続する
- 認証トークンを使用して接続する

#### F1.2: イベント処理
- 以下のイベントタイプを受信・処理する:
  - `ai_edit_start` - AI編集開始（jupyter-mcp の handleToolCall ミドルウェアが自動配信）
  - `cell_added` - セル追加
  - `cell_execute_start` - セル実行開始
  - `cell_output` - セル出力（ストリーミング）
  - `cell_execute_end` - セル実行完了
  - `ai_edit_end` - AI編集終了（jupyter-mcp の handleToolCall ミドルウェアが自動配信）

### F2: ノートブックUIのリアルタイム更新

#### F2.1: セル追加の反映
- `cell_added`イベントを受信したら、対象ノートブックの指定位置にセルを挿入する
- セルのタイプ（code/markdown）とソースコードを設定する
- 追加されたセルにスクロールする

#### F2.2: セル実行結果の反映
- `cell_execute_start`イベントを受信したら、対象セルの executionCount を null に設定して実行中状態（[*] 表示）にする
- `cell_output`イベントを受信したら、セルの出力エリアにストリーミング追加する
  - `stream` タイプ: stdout/stderrテキストを追加
  - `display_data` タイプ: 画像等のリッチ出力を表示
  - `execute_result` タイプ: 式の評価結果を表示
  - `error` タイプ: エラー出力を表示
- `cell_execute_end`イベントを受信したら、セルの実行中状態を解除し、execution_countを設定する

### F3: ノートブックロック機能

#### F3.1: ロック開始
- `ai_edit_start`イベント（ノートブック編集系ツール実行時にミドルウェアが自動配信）を受信したら、対象ノートブックをread-onlyモードにする
- ユーザーのキーボード入力、セル編集、セル実行を無効化する
- ロック中であることを示すUIインジケータを表示する（例: ツールバーにバナー表示）

#### F3.2: ロック解除
- `ai_edit_end`イベント（ツール実行完了時にミドルウェアが自動配信）を受信したら、ノートブックのread-onlyモードを解除する
- ユーザーの入力を再度有効化する
- UIインジケータを非表示にする

#### F3.3: ロック中のユーザー体験
- ロック中もノートブックのスクロール・閲覧は可能
- AIが追加したセルや実行結果はリアルタイムに表示される
- ロック理由（「AI が編集中です」等）をユーザーに明示する

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
- `@jupyterlab/filebrowser`（IFileBrowserFactory — ファイルブラウザUI操作）
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

### AC1: セル追加のリアルタイム反映
- [ ] AIが`notebook_add_cell`を呼ぶと、ブラウザ上のノートブックにセルが即座に追加される
- [ ] 追加されたセルのソースコードが正しく表示される

### AC2: セル実行結果のリアルタイム反映
- [ ] AIが`execute_code`を呼ぶと、ブラウザ上のセルに実行結果が表示される
- [ ] stdout/stderrが正しく表示される
- [ ] matplotlib等の画像出力が正しく表示される
- [ ] エラー出力が正しく表示される
- [ ] 実行開始時に executionCount が null に設定され、セルに [*] が表示される
- [ ] 実行完了時に execution_count が正しく設定される
- [ ] SharedModelの`cell.outputs`に出力が正しく書き戻される（ファイル保存時の整合性）

### AC3: ノートブックロック
- [ ] ノートブック編集系ツール実行時に `ai_edit_start` イベントが自動配信され��ノートブックがread-onlyにな���
- [ ] ロッ���中はキーボード入力・セル��集ができない
- [ ] ロック中であることを示すインジケータが表示され��
- [ ] ツール実行完了後に `ai_edit_end` イ��ントが自動配信され、ロックが解除される
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

## 依存関係

- jupyter-serverのAI同期WebSocketエンドポイント（`/api/ai/events`）が実装されていること
