# Issue #90: ノートブックロックのパス正規化が save 検査と共有されず表記揺れでバイパスの余地

## 関連タスク

- タスク番号: 21.2

## ステータス

- [x] 起票
- [ ] 原因特定
- [ ] 修正方針レビュー完了
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

## 原因（調査後に記入）

（根本原因）

## 修正方針（調査後に記入）

### 影響範囲

（修正が影響するファイル・コンポーネント）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `path/to/file` | （変更内容） |

### テスト計画

（どのようにテストするか）
