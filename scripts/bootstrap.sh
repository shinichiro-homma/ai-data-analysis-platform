#!/bin/bash
# bootstrap.sh — 初回セットアップスクリプト
# Usage: bash scripts/bootstrap.sh
set -euo pipefail

# ── ヘルパー関数 ──────────────────────────────────────────────────────────────
log_info() {
  echo "[INFO] $*"
}

log_warn() {
  echo "[WARN] $*" >&2
}

log_error() {
  echo "[ERROR] $*" >&2
}

# ── リポジトリルートに移動 ────────────────────────────────────────────────────
cd "$(git rev-parse --show-toplevel)"

# ── uv 検知 ──────────────────────────────────────────────────────────────────
if command -v uv > /dev/null 2>&1; then
  log_info "uv が見つかりました: $(command -v uv)"
elif [ -x "$HOME/.local/bin/uv" ]; then
  log_warn "uv が PATH に見つかりません。~/.local/bin/uv は存在しますが未反映です。"
  log_warn "以下のいずれかを実行してシェルを再起動してください:"
  log_warn ""
  log_warn "  # ~/.bashrc に追記して PATH を反映する場合:"
  log_warn "  echo '. \"\$HOME/.local/bin/env\"' >> ~/.bashrc"
  log_warn "  source ~/.bashrc"
  log_warn ""
  log_warn "  # または現在のシェルで一時的に反映する場合:"
  log_warn "  . \"\$HOME/.local/bin/env\""
  log_warn ""
  log_warn "反映後に再度 bash scripts/bootstrap.sh を実行してください。"
  exit 1
else
  log_error "uv が見つかりません。以下の公式コマンドでインストールしてください:"
  log_error ""
  log_error "  curl -LsSf https://astral.sh/uv/install.sh | sh"
  log_error ""
  log_error "インストール後にシェルを再起動し、再度 bash scripts/bootstrap.sh を実行してください。"
  exit 1
fi

# ── Python 依存関係の同期 ─────────────────────────────────────────────────────
log_info "Python 依存関係を同期しています (uv sync)..."
uv sync
log_info "uv sync 完了。"

# ── git 設定 ─────────────────────────────────────────────────────────────────
log_info "git hooks を有効化しています (core.hooksPath = .githooks)..."
git config core.hooksPath .githooks

log_info "fetch.prune を有効化しています..."
git config fetch.prune true

log_info "git 設定完了。"

# ── .env 初期化 ───────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  log_warn ".env を .env.example からコピーしました。"
  log_warn "本番利用時は .env 内の POSTGRES_PASSWORD / JUPYTER_TOKEN を必ず変更してください。"
else
  log_info ".env は既に存在するためスキップしました。"
fi

# ── 完了 ─────────────────────────────────────────────────────────────────────
log_info "bootstrap 完了。次のステップ: docker compose up -d"
