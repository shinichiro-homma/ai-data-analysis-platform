---
paths:
  - pyproject.toml
  - "**/pyproject.toml"
  - .python-version
  - scripts/**/*.sh
  - scripts/**/*.py
  - .claude/hooks/block-direct-python.sh
  - jupyterlab-ai-sync/**/*.md
---

# uv による Python 実行ルール

## 基本原則

このプロジェクトではルートの `pyproject.toml` + `.venv/` （uv 管理）を Python の基盤とする。
`python` / `python3` / `pip` / `pip3` を直接呼び出してはならない。

## 正しい実行方法

```bash
# Python スクリプトの実行
uv run python script.py

# インラインコードの実行
uv run python -c "import sys; print(sys.version)"

# pip パッケージのインストール（開発用のみ）
uv add --dev <package>

# 依存関係の同期
uv sync
```

## 初回セットアップ

clone 後に 1 度だけ実行する：

```bash
uv sync
```

これにより `.venv/` が作成され、`pyproject.toml` の依存関係がインストールされる。

## 禁止事項

- `python script.py` → `uv run python script.py` を使う
- `python3 -c "..."` → `uv run python -c "..."` を使う
- `pip install foo` → `uv add --dev foo` を使う（または `uv run pip install foo`）
- `pip3 install foo` → 同上

## フック

`.claude/hooks/block-direct-python.sh` が PreToolUse フックとして登録されており、
`python` / `python3` / `pip` / `pip3` の直叩きを検出して exit 2 でブロックする。
`uv run python ...` / `uv run pip ...` 経由は通過する。

## ローカル mypy / pytest の実行

mypy と pytest はルート venv 経由で実行する。per-component `.venv/` は使わない。

```bash
# 型チェック（ルートから実行）
uv run mypy <component>/src

# テスト（コンポーネントディレクトリに cd してから実行）
cd <component> && uv run --project <repo_root> pytest
```

- `src/` が存在しないコンポーネント（jupyter-server 等）の mypy はスキップする
- pytest は `cd <component>` で rootdir を合わせてから `uv run --project <repo_root>` でルート venv を利用する
- `scripts/test.sh` はこのルールに従って自動実行する

## jupyterlab-ai-sync ビルド

`jupyterlab-ai-sync` の `npm run build`（内部で `tsc && jupyter labextension build .` を呼ぶ）はルート venv 経由で実行する。
`jupyterlab-ai-sync/` 内で `uv run` を実行すると同ディレクトリの `pyproject.toml`（build backend）を拾うため、
`--project <repo_root>` を明示してルート venv を使わせる。

```bash
# jupyterlab-ai-sync のビルド（リポジトリルートから実行）
(cd jupyterlab-ai-sync && uv run --project .. npm run build)

# 開発モードインストール
uv run jupyter labextension develop . --overwrite
```

`scripts/test.sh jupyterlab-ai-sync` はこのルールに従って自動実行する。

## Docker 経路の例外

`Dockerfile` / `docker-compose.yml` 内の `RUN pip install` 等は Docker ビルド経路のため変更しない。
`jupyter-server/requirements.txt` も同様。
