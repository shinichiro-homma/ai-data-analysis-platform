# Infrastructure

テスト、ビルド、データロード、Formatter に関する Phase。

完了した Phase 1〜10 は [archive/04-infrastructure.md](archive/04-infrastructure.md) を参照。

---

## Phase 11: 負債予防の開発プロセス整備

機能単位開発の盲点（どの機能にも属さない性質の放置）を制度で塞ぐ Phase。背景は `docs/design/invariants.md` と `docs/adr/0001` を参照。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 11.1 | ADR・横断不変条件・タスク設計ルールの整備 | [x] | 計画作成時に異常系AC・不変条件・ADR要否のチェックが要求され、/custom-debt-review で横断監査が実行できる | docs/adr/（テンプレ+0001）、docs/design/invariants.md（I1〜I8）、task-design.md チェックリスト拡張、change-requirement に異常系レンズ追加 |
| 11.2 | CI 適応度関数（構造予算の機械検知） | [ ] | ファイルサイズ予算超過・async 内ブロッキング I/O（ruff ASYNC ルール）・コピペ検出が CI で検知される | 既存違反（handlers.py 1,515行等）の解消とセットで有効化。リファクタ Phase と同時に計画する |

---

## Phase 12: ビルド再現性の確保

同じコミットから同じビルド成果物を得られるよう、バージョン固定の穴を塞ぐ Phase。リファクタリングと独立して先行実施できる quick win。

| # | タスク | ステータス | E2Eテスト | 備考 |
|---|--------|-----------|-----------|------|
| 12.1 | Docker ベースイメージの digest 固定 | [ ] | `docker compose build` が digest 固定のイメージを使用し、異なる日にビルドしても同じベースレイヤーになる | jupyter-server / document-server / postgres |
| 12.2 | Python 依存バージョン統一と JupyterLab 明示固定 | [ ] | requirements.txt の pyarrow が uv.lock と一致し、JupyterLab バージョンが明示固定されている | pyarrow==19.0.1→23.0.1 統一、jupyterlab ピン追加 |
| 12.3 | docker-compose 表記の v2 統一 | [ ] | `grep -r "docker-compose"` がプロジェクト内でヒットしない（docker compose v2 表記に統一） | bootstrap.sh、CLAUDE.md 類 |
| 12.4 | Node.js バージョンの明示固定 | [ ] | .nvmrc が存在し、package.json に engines フィールドがあり、CI と一致する | 全 package.json + .nvmrc |
| 12.5 | jupyterlab-ai-sync ビルドの決定的化 | [ ] | Dockerfile と CI で `npm ci` が使用され、`npm install` が使われていない | npm install → npm ci |
