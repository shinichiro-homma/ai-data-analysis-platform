# Issue #6: workspace_createのoutput_pathがカーネルcwd相対でないため二重ディレクトリが作成される

## 関連タスク

- タスク番号: Workspace 1.1, Workspace 1.4

## ステータス

- [x] 起票
- [x] 原因特定
- [x] 修正方針レビュー完了
- [x] 修正完了

## 症状

`workspace_create` が返す `output_path`（例: `workspaces/ws-96fb1d21/output`）は Jupyter content root 相対のパスだが、カーネルの cwd はワークスペースディレクトリ内（`/home/jovyan/work/workspaces/ws-96fb1d21/`）に設定されている。

AIがこのパスをそのまま `plt.savefig(output_path + "/chart.png")` のように使うと、ワークスペース内に `workspaces/ws-xxx/output/` というネストされたディレクトリが作成される。

実際の構造:
```
/home/jovyan/work/workspaces/ws-96fb1d21/
├── data/
├── output/
├── workspaces/          ← 不正にネスト作成
│   └── ws-96fb1d21/
│       └── output/
│           └── store_sales_analysis.png
├── metadata.json
└── store_sales_analysis.ipynb
```

また、グラフ等のアウトプットはワークスペース直下の `output/` ディレクトリに保存されるべきだが、現在そのガイドがツール説明にない。

## 再現手順

1. `workspace_create` でワークスペースを作成する
2. `session_create` でセッションを作成する
3. `execute_code` で `plt.savefig("workspaces/ws-xxx/output/chart.png")` のように `output_path` をそのまま使ったコードを実行する
4. ワークスペース内に `workspaces/` ディレクトリがネストして作成される

## 再現確認結果

- 再現: できた
- 確認方法: Playwright でブラウザ操作 + docker exec でファイルシステム確認
- エビデンス: [evidence-nested-workspace.png](evidence-nested-workspace.png)

## 期待する動作

1. `workspace_create` のレスポンスで、カーネル cwd からの相対パス（`output`、`data`）を返す、または別フィールドで提供する
2. グラフ等のアウトプットはデフォルトでワークスペース直下の `output/` ディレクトリに保存されるようツール説明でガイドする
3. ワークスペース内にワークスペース構造が二重に作成されないようにする

## 原因

### 根本原因

`workspace_create` / `workspace_list` MCP ツールが返す `output_path` と `data_path` が **Jupyter content root 相対パス**（例: `workspaces/ws-xxx/output`）であるのに対し、`session_create` で起動されるカーネルの cwd は **ワークスペースディレクトリ**（例: `/home/jovyan/work/workspaces/ws-xxx/`）に設定されている。

AI がカーネル内コードで `output_path` をそのまま使うと、cwd からの相対パスとして解釈され、`{workspace_dir}/workspaces/ws-xxx/output/` という二重ディレクトリが作成される。

### 関連箇所

- `jupyter-mcp/src/tools/workspace-create.ts` (行 44-51): jupyter-server から受け取った content root 相対パスをそのまま返している
- `jupyter-mcp/src/tools/workspace-list.ts` (行 23-33): 同上
- `jupyter-mcp/src/tools/index.ts` (行 26-38): ツール description にパスの基準点や output/ の使い方のガイドがない

### 仕様の内部矛盾

要件定義の受け入れ条件 AC9 では「カーネル内で `data/input.csv` や `output/result.csv` にアクセスできる」（kernel-cwd 相対）としているが、同じ要件定義の workspace_create 戻り値スキーマでは `workspaces/ws-xxx/output`（content root 相対）を返す定義になっている。AC9 が意図する動作が正しく、戻り値スキーマを修正する必要がある。

## 修正方針

MCP ツール層で `data_path` / `output_path` をカーネル cwd 相対パスに変換して返す。REST API（`POST /api/workspaces`）は変更しない（MCP 内部で content root 相対パスが必要なため）。

### 変換ロジック

```typescript
// workspace.path = "workspaces/ws-xxx"
// workspace.data_path = "workspaces/ws-xxx/data"
// workspace.output_path = "workspaces/ws-xxx/output"

// カーネル cwd 相対に変換: workspace.path プレフィックスを除去
const kernelDataPath = workspace.data_path.replace(workspace.path + "/", "");
// → "data"
const kernelOutputPath = workspace.output_path.replace(workspace.path + "/", "");
// → "output"
```

### ツール description の改善

`workspace_create` の description に、返されるパスがカーネル cwd 相対であること、グラフ等のアウトプットは `output/` ディレクトリに保存すべきことを明記する。

### 影響範囲

- **コンポーネント**: jupyter-mcp のみ（REST API 変更なし）
- **要件定義**: `docs/requirements/jupyter-mcp.md` の workspace_create 戻り値スキーマを修正（AC9 との矛盾を解消）
- **API 仕様**: `docs/design/api-contracts.md` は変更不要（REST API は変更なし。MCP ツール定義部分があれば修正）

### 修正ファイル

| ファイル | 変更内容 |
|----------|----------|
| `jupyter-mcp/src/tools/workspace-create.ts` | `data_path` / `output_path` をカーネル cwd 相対に変換して返す |
| `jupyter-mcp/src/tools/workspace-list.ts` | 同上（workspace 一覧の各エントリに対して変換） |
| `jupyter-mcp/src/tools/index.ts` | `workspace_create` の description を更新（パスの説明、output/ の使い方ガイド追加） |
| `jupyter-mcp/tests/unit/tools/workspace-create.test.ts` | 期待値を `"data"` / `"output"` に更新 |
| `jupyter-mcp/tests/unit/tools/workspace-list.test.ts` | 期待値を `"data"` / `"output"` に更新 |
| `jupyter-mcp/tests/integration/workspace-isolation.test.ts` | output_path の期待値を更新（該当テストケース） |
| `docs/requirements/jupyter-mcp.md` | workspace_create 戻り値スキーマの `data_path` / `output_path` を修正 |

### テスト計画

1. **単体テスト**: `workspace-create.test.ts` / `workspace-list.test.ts` で変換後のパスが正しいことを確認
2. **統合テスト**: `workspace-isolation.test.ts` でカーネル内から `output/result.csv` に書き込めることを確認
3. **回帰テスト**: 既存の統合テスト全体を実行し、他機能への影響がないことを確認
