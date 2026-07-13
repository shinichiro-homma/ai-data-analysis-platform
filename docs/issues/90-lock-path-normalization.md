# Issue #90: ノートブックロックのパス正規化が save 検査と共有されず表記揺れでバイパスの余地

## 関連タスク

- タスク番号: 21.2

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [ ] 修正完了

## 症状

ノートブックロックのパス正規化が、ロック API と save 検査で同一関数を共有していない（21.2/21.3 レトロスペクティブ監査の指摘 4）。

- ロック API 側: `jupyter-server/extensions/custom_api/lock_handlers.py:29-52` の `_validate_lock_path` は `lstrip("/")` のみで正規化する（`..` と `\0` は拒否するが、`.` セグメント・連続スラッシュは正規化しない）
- save 検査側: `jupyter-server/extensions/custom_api/__init__.py:63-66` の `_wrap_contents_save` は `contents_manager.save` に渡る生のパス文字列をそのまま `get_lock_token(path)` の辞書キー照合に使う

このため `./ws/x.ipynb` や `ws//x.ipynb` のような表記揺れでロックキーと save 検査キーが食い違い、ロック中でも別表記の直接 API 呼び出しが 423 をすり抜ける構造的余地がある。不変条件 I2（サーバー側強制の単一チョークポイント）の原則に反する。

## 再現手順

1. ロックを取得: `PUT /api/custom/notebook-locks` に `{"notebook_path": "ws/x.ipynb", ...}`
2. 表記揺れパスで書き込み: 標準 Contents API に `ws//x.ipynb` 等の非正規化パスで PUT
3. `get_lock_token("ws//x.ipynb")` が None を返し、423 にならず保存が通るかを確認する

## 再現確認結果

- 再現: 未確証（静的検証のみ）。実際にバイパスが成立するかは jupyter-server の contents_manager が save 前にパスをどこまで正規化するかに依存する
- 確認方法: 監査でのコード裏取り（正規化箇所が 2 箇所に分かれ同一関数でないことを確認済み）。既存テスト `test_notebook_locks.py::TestLockPathNormalization` は先頭スラッシュのみ検証

## 期待する動作

- ロック取得・ロック検査（save ラップ）・保存の 3 箇所が同一の正規化関数を共有し、同じ正規化済みキーで照合する
- `TestLockPathNormalization` に `./` セグメント・連続スラッシュのケースを追加し、バイパス不成立を回帰テストで担保する

## 原因

ロック取得キーの生成と save 検査時のキー照合が、異なる正規化ロジックを個別に実装しており、共有された単一の正規化関数が存在しない。

3箇所のパス処理が独立している:

1. **`lock_handlers.py:48-49`** — `_validate_lock_path`: `lstrip("/")` のみ。`.` セグメント・連続スラッシュは正規化しない
2. **`__init__.py:63-66`** — `_wrap_contents_save`: 正規化処理なし。`contents_manager.save` に渡る生の `path` をそのまま `get_lock_token(path)` の辞書キー照合に使用
3. **`notebook_locks.py:102-109`** — `get_lock_token`: 単純な `dict.get(path)` でキーが完全一致しないと `None` を返す

バイパス条件: ロックを `ws/x.ipynb` で取得後、`./ws/x.ipynb` や `ws//x.ipynb` で save を呼ぶとキーが不一致になり、423 を返さず保存が通る。

なお、`handlers.py:106-136` の `validate_path` は `Path.resolve()` でトラバーサル検証を行うが、ロック機構とは無関係で import されていない。

## 修正方針

共有の `normalize_notebook_path()` 関数を `notebook_locks.py` に追加し、ロック取得・save 検査の両方でこの関数を使ってパスを正規化する。

正規化処理の内容:
- 先頭 `/` の除去（既存の `lstrip("/")` と同等）
- 連続スラッシュの統一（`ws//x.ipynb` → `ws/x.ipynb`）
- `.` セグメントの除去（`./ws/x.ipynb` → `ws/x.ipynb`）
- `..` と `\0` の拒否は `_validate_lock_path` に残す（正規化とバリデーションの責務分離）

適用箇所:
- `_validate_lock_path` 内で `lstrip("/")` の代わりに `normalize_notebook_path()` を呼ぶ
- `_wrap_contents_save` 内で `get_lock_token(path)` の前に `normalize_notebook_path(path)` を適用する
- `notebook_locks.py` の `acquire` / `get_lock_token` でも入口で正規化を適用する（防御的多重適用）

### 影響範囲

- jupyter-server コンポーネントのみ（他コンポーネントへの影響なし）
- 要件定義 `docs/requirements/jupyter-server.md` の F4.4 にパス正規化要件の明示を追加（仕様に欠落していたため）
- API 仕様の変更は不要（外部インターフェースは変わらない）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-server/extensions/custom_api/notebook_locks.py` | `normalize_notebook_path()` 関数を追加。`acquire` / `get_lock_token` の入口で正規化を適用 |
| `jupyter-server/extensions/custom_api/lock_handlers.py` | `_validate_lock_path` 内で `normalize_notebook_path()` を使用（`lstrip("/")` を置換） |
| `jupyter-server/extensions/custom_api/__init__.py` | `_wrap_contents_save` 内で save 検査前にパスを正規化 |
| `jupyter-server/tests/test_notebook_locks.py` | `TestLockPathNormalization` に `.` セグメント・連続スラッシュのテストケースを追加。表記揺れでの save バイパス不成立を検証するテストを追加 |
| `docs/requirements/jupyter-server.md` | F4.4 にパス正規化の統一要件を追記 |

### テスト計画

1. **正規化関数の単体テスト**: `normalize_notebook_path()` に対して以下の入力を検証
   - `./ws/x.ipynb` → `ws/x.ipynb`
   - `ws//x.ipynb` → `ws/x.ipynb`
   - `/ws/x.ipynb` → `ws/x.ipynb`
   - `ws/./sub/x.ipynb` → `ws/sub/x.ipynb`
   - `ws///x.ipynb` → `ws/x.ipynb`（3連スラッシュ）
2. **ロック取得→表記揺れ save の統合テスト**: ロックを正規パスで取得後、表記揺れパスで save を試みて 423 が返ることを検証
3. **逆方向テスト**: 表記揺れパスでロック取得後、正規パスで save を試みて 423 が返ることを検証
4. **既存テストの回帰確認**: `test_notebook_locks.py` の既存テストが全て通ることを確認
