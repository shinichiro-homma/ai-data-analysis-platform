# 用語の追加・編集ガイド

用語集に新しい用語を追加する、または既存の用語を編集する際の手順とルールを説明する。

## 概要

用語集に用語を登録すると、AIが `get_term_index` / `get_term_detail` ツールで用語の定義・別名・関連用語を参照できるようになる。AIが業務用語を正しく理解し、分析時に適切な用語にマッチできるようにするために、社内固有の略称や業務用語を登録する。

## 前提条件

- Docker環境が起動済み（`docker-compose up -d`）
- 追加する用語の正式名称・定義・別名が決まっている

---

## ファイル構成

```
document-server/data/glossary/
├── index.yaml              # 用語インデックス（第1層）
└── terms/
    ├── ロイヤルティランク.yaml   # 用語詳細（第2層）
    ├── 統合会員ID.yaml
    └── 店舗.yaml
```

## 手順

### 1. 用語詳細ファイルを作成する（第2層）

`document-server/data/glossary/terms/` に YAML ファイルを作成する。ファイル名は用語の正式名称にする。

```yaml
name: "ポイントキャンペーン"
aliases: ["ポイントCP", "PC"]
definition: "期間限定のポイント付与施策。対象商品の購買に対して通常より多いポイントを付与する。"
related_terms: ["ロイヤルティランク"]
values:
  - label: "通常CP"
    description: "全品対象のポイントアップ"
  - label: "カテゴリCP"
    description: "特定カテゴリ限定のポイントアップ"
```

### 2. インデックスにエントリを追加する（第1層）

`document-server/data/glossary/index.yaml` に用語を追加する。

```yaml
terms_index:
  # ... 既存のエントリ ...
  - name: "ポイントキャンペーン"
    summary: "期間限定のポイント付与施策"
```

### 3. リロードする

サーバーの再読み込み API を呼び出すか、サーバーを再起動する。

```bash
curl -X POST http://localhost:3002/admin/reload
```

### 4. 動作確認

以下を確認する:

1. `GET /glossary/index` でインデックスに表示されること
2. `GET /glossary/index?query={alias}` で aliases 検索がヒットすること
3. `POST /glossary/terms` で詳細が取得できること

```bash
# インデックス確認（全件取得）
curl http://localhost:3002/glossary/index | jq .

# aliases 検索確認
curl "http://localhost:3002/glossary/index?query=PC" | jq .

# 詳細確認
curl -X POST http://localhost:3002/glossary/terms \
  -H "Content-Type: application/json" \
  -d '{"term_names": ["ポイントキャンペーン"]}' | jq .
```

---

## 各フィールドの説明

### 第1層（index.yaml）

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `name` | ○ | 用語の正式名称。第2層ファイル名と一致させる |
| `summary` | ○ | 一行説明。AI が全体像を把握するために使用 |

### 第2層（個別 YAML）

| フィールド | 必須 | 型 | 説明 |
|-----------|------|-----|------|
| `name` | ○ | string | 用語の正式名称 |
| `aliases` | ○ | string[] | 別名・略称のリスト（後述の詳細ルールを参照） |
| `definition` | ○ | string | 用語の定義・説明。業務コンテキストを含めて記述する |
| `related_terms` | 任意 | string[] | 関連する別の用語名のリスト。name の正式名称で指定する |
| `values` | 任意 | object[] | 値の体系がある場合のみ記載（コード値、ランク区分等） |
| `values[].label` | ○ | string | 値の名称（例: "レギュラー"、"シルバー"） |
| `values[].description` | ○ | string | 値の説明（例: "基本ランク"、"年間購買額XX万円以上"） |

---

## aliases の書き方

### 目的

aliases は **AI が意味的に推測できない略称・社内用語・表記揺れ** を登録するためのフィールド。サーバー起動時に aliases から検索インデックスが構築され、`get_term_index(query="略称")` で部分一致検索に使用される。

### 書くべきもの

| 種類 | 例 | 理由 |
|------|-----|------|
| 社内略称 | `PC`、`ポイントCP` | AI は「PC = ポイントキャンペーン」を推測できない |
| 英語の略称 | `LR`（Loyalty Rank） | 文脈なしでは意味が特定できない |
| 組織固有の呼び名 | `星ランク`（ロイヤルティランク） | 一般的でない呼称 |

### 書かなくてよいもの

| 種類 | 例 | 理由 |
|------|-----|------|
| 正式名称の表現揺れ | `ポイントのキャンペーン` | AI が意味的にマッチできる |
| 正式名称の英語表記 | `Point Campaign` | name から推測可能 |
| 一般的な言い換え | `ポイント施策` | summary や definition の記述から AI が推測できる |

### 判断基準

> **その略称だけを見て、AI が正しい用語を特定できるか？**
>
> - 特定できない → aliases に書く
> - 特定できる → 書かなくてよい

### 検索の仕組み

aliases は **部分一致** で検索される。

```
aliases: ["ポイントCP", "PC"]

get_term_index(query="PC")        → ヒット（完全一致）
get_term_index(query="ポイント")   → ヒット（「ポイントCP」に部分一致）
```

検索でヒットしなかった場合、AI は `get_term_index()`（全件取得）にフォールバックし、name と summary から意味的にマッチングを試みる。そのため、aliases に全パターンを網羅する必要はない。

---

## 用語追加のチェックリスト

- [ ] 第2層 YAML のファイル名が `name` と一致している
- [ ] 第1層 index.yaml に `name` と `summary` を追加した
- [ ] `aliases` に AI が推測できない略称・社内用語を登録した
- [ ] `definition` に業務コンテキストを含めて記述した
- [ ] `related_terms` に関連する用語の正式名称を指定した（該当する場合）
- [ ] `values` にコード値・区分値を記載した（該当する場合）
- [ ] サーバーをリロードして動作確認した

---

## 注意事項

- **名前の一致**: `index.yaml` の `name`、第2層 YAML ファイル名、YAML 内の `name` フィールドはすべて一致させること。不一致があるとAPIで取得できない。
- **`related_terms` の参照先**: `index.yaml` に登録済みの用語名（`name`）を指定すること。存在しない用語名を指定してもエラーにはならないが、AIが参照先を辿れなくなる。
- **aliases の重複**: 複数の用語で同じ alias を使うと、検索時に両方の用語がヒットする。意図的な場合は問題ないが、意図せず重複している場合はいずれかを修正すること。
