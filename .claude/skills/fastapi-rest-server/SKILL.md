---
name: fastapi-rest-server
description: Python FastAPI REST APIサーバーの実装パターン（document-server基準）。新規ルーター・モデル追加時に使用する。
---

# FastAPI REST Server

## 概要

Python FastAPI による REST API サーバーの実装パターン。document-server で確立されたパターンを基にする。

- インメモリデータストアへの起動時ロード
- インデックス（一覧）/ 詳細（一括取得）の2層 API 構成
- Pydantic モデルによるバリデーション
- レスポンスヘルパーによる統一レスポンス形式
- FastAPI の依存性注入（`Depends`）によるストアアクセス

## どのリファレンスを読むか

実装対象に応じて、以下のリファレンスファイルを読むこと。すべてを読む必要はない。

| ファイル | 内容 | 読むタイミング |
|---------|------|----------------|
| `reference/app-setup.md` | プロジェクト構成、config.py、main.py（lifespan/CORS/ヘルスチェック）、responses.py、Dockerfile | 新規サーバーの土台を作る、または起動処理・CORS 設定を変更するとき |
| `reference/router-patterns.md` | APIRouter の基本構造、インデックス/詳細一括/個別取得/管理エンドポイントの4パターン、依存性注入 | 新しいルーター・エンドポイントを追加するとき |
| `reference/pydantic-models.md` | インデックス/詳細/リクエスト/ドメインモデルの定義パターン、共通バリデータ、エイリアス | リクエスト/レスポンスモデルを追加・変更するとき |
| `reference/data-loader.md` | CatalogStore のインメモリ設計、YAML 読み込み、`_load_resource()` 共通処理、found/not_found 分離検索 | データローダー（新しいリソース種別の読み込み）を追加するとき |
| `reference/testing.md` | conftest.py のテストデータ・フィクスチャパターン、Router/CatalogStore/Pydantic モデルのテストテンプレート | このコンポーネントのテストを書くとき（テスト全般の原則は `testing-strategies` Skill を参照） |

## チェックリスト

### 新しいルーター追加時

1. `src/routers/{name}.py` を作成
   - `APIRouter(prefix="/{path}", tags=["{tag}"])` を定義
   - `Depends(get_catalog_store)` で依存性注入を使用
   - `index_response()` / `detail_response()` / `error_response()` でレスポンスを統一
2. `src/main.py` にルーターを登録
   - `from .routers import {name}` をインポート
   - `app.include_router({name}.router)` を追加
3. 必要に応じて `src/models.py` にリクエスト/レスポンスモデルを追加
   - リクエストモデルには `Field(..., min_length=1, max_length=100)` でバリデーション
   - 文字列フィールドには `_strip_string` バリデータの適用を検討
4. `src/catalog_loader.py` にデータ取得メソッドを追加
   - `_load_resource()` の共通パターンを活用
   - `_lookup_many()` で一括検索を実装
5. テストを追加
   - `tests/conftest.py` にサンプルデータ定数を追加
   - `tests/test_{name}_api.py` に API テストを作成
   - インデックス / 詳細一括(全件OK / 部分not_found / 全件not_found) / バリデーションエラーを網羅

### エンドポイント追加時の確認項目

- [ ] レスポンス形式が `{"data": ...}` / `{"error": ...}` に従っているか
- [ ] `response_model=None` を POST エンドポイントに指定しているか（手動で dict を返す場合）
- [ ] パスパラメータに正規表現バリデーション（`pattern`）と最大長を設定しているか
- [ ] エラーコードが `docs/design/api-contracts.md` のエラーコード一覧と整合しているか
- [ ] `model_dump()` 時に `by_alias=True` が必要なモデル（`DateRange` の `from` エイリアス等）を確認しているか
- [ ] テストで正常系・部分エラー・全件エラー・バリデーションエラーの4パターンを網羅しているか
