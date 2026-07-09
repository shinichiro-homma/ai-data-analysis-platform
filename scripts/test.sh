#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
source scripts/lib/common.sh

COMPONENTS=(jupyter-mcp document-mcp document-server jupyter-server jupyterlab-ai-sync hooks)

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS] [COMPONENT...]

コンポーネントの型チェックとテストを実行します。

COMPONENT:
  jupyter-mcp           Jupyter MCP サーバー
  document-mcp          Document MCP サーバー
  document-server       Document サーバー
  jupyter-server        Jupyter サーバー
  jupyterlab-ai-sync    JupyterLab AI 同期拡張
  hooks                 Claude Code hooks（.claude/hooks/tests/*.test.sh）
  (省略時は全コンポーネント)

OPTIONS:
  --typecheck     型チェックのみ
  --test          テストのみ
  --integration   統合テスト（Docker 環境が必要）
  --rebuild       テスト前にコンポーネントを自動リビルド（MCP/Docker を自動判定）
  --health        テスト後に既知障害と照合して分類する
  --no-lint       lint / format チェックをスキップする
  -h, --help      このヘルプを表示

Examples:
  $(basename "$0")                                    # 全コンポーネントの型チェック+テスト
  $(basename "$0") jupyter-mcp                        # jupyter-mcp のみ
  $(basename "$0") --typecheck                        # 全コンポーネントの型チェックのみ
  $(basename "$0") --test jupyter-mcp                 # jupyter-mcp のテストのみ
  $(basename "$0") --integration jupyter-mcp          # jupyter-mcp の統合テスト
  $(basename "$0") --rebuild jupyter-mcp               # MCP リビルド + テスト
  $(basename "$0") --rebuild                            # 全コンポーネントリビルド + テスト
  $(basename "$0") --integration --rebuild              # リビルド後に統合テスト
EOF
}

TYPECHECK=true
TEST=true
LINT=true
HEALTH=false
INTEGRATION=false
REBUILD=false
TARGETS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --typecheck)     TEST=false; shift ;;
    --test)          TYPECHECK=false; shift ;;
    --integration)   INTEGRATION=true; shift ;;
    --rebuild)       REBUILD=true; shift ;;
    --no-lint)       LINT=false; shift ;;
    --health)        HEALTH=true; shift ;;
    -h|--help)    usage; exit 0 ;;
    -*)           echo "Error: unknown option $1" >&2; usage; exit 1 ;;
    *)
      found=false
      for c in "${COMPONENTS[@]}"; do
        if [[ "$1" == "$c" ]]; then found=true; break; fi
      done
      if ! $found; then
        echo "Error: unknown component '$1' (available: ${COMPONENTS[*]})" >&2
        exit 1
      fi
      TARGETS+=("$1"); shift ;;
  esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("${COMPONENTS[@]}")
fi

# Classify targets into MCP and Docker groups
classify_rebuild_targets() {
  MCP_REBUILD_TARGETS=()
  DOCKER_REBUILD_TARGETS=()
  for _component in "${TARGETS[@]}"; do
    case "$_component" in
      jupyter-mcp|document-mcp) MCP_REBUILD_TARGETS+=("$_component") ;;
      jupyter-server|document-server) DOCKER_REBUILD_TARGETS+=("$_component") ;;
    esac
  done
}

# Execute rebuild based on classified targets
run_rebuild() {
  classify_rebuild_targets
  if [[ ${#MCP_REBUILD_TARGETS[@]} -gt 0 ]]; then
    scripts/rebuild-mcp.sh "${MCP_REBUILD_TARGETS[@]}"
  fi
  if [[ ${#DOCKER_REBUILD_TARGETS[@]} -gt 0 ]]; then
    scripts/rebuild.sh "${DOCKER_REBUILD_TARGETS[@]}"
  fi
}

echo "=== Test Runner ==="
echo "Targets: ${TARGETS[*]}"
echo "Typecheck: $TYPECHECK | Test: $TEST | Lint: $LINT | Integration: $INTEGRATION"
echo ""

# Lint check (before any build/test)
if $LINT; then
  echo "--- Lint / Format Check ---"
  # Map test.sh component names to lint.sh component names
  # test.sh targets: jupyter-mcp, document-mcp, document-server, jupyter-server
  # lint.sh also supports: mcp-shared, scripts
  # hooks はシェルスクリプト group のため lint.sh の対象外（スキップする）
  LINT_TARGETS=()
  for _t in "${TARGETS[@]}"; do
    [[ "$_t" == "hooks" ]] && continue
    LINT_TARGETS+=("$_t")
  done
  # Always include mcp-shared and scripts when running all components
  if [[ ${#TARGETS[@]} -eq ${#COMPONENTS[@]} ]]; then
    LINT_TARGETS+=("mcp-shared" "scripts")
  fi
  if [[ ${#LINT_TARGETS[@]} -eq 0 ]]; then
    echo "  SKIP: no lint targets (hooks only)"
    echo ""
  elif scripts/lint.sh "${LINT_TARGETS[@]}"; then
    echo ""
  else
    echo ""
    echo "ERROR: Lint check failed. Fix lint issues before running tests."
    exit 1
  fi
fi

# Integration mode: check Docker environment
if $INTEGRATION; then
  echo "--- Pre-flight: Docker Environment ---"

  # Integration tests require DATA_ENV=sample
  CURRENT_DATA_ENV=$(read_data_env)
  if [[ "$CURRENT_DATA_ENV" != "sample" ]]; then
    if $REBUILD; then
      echo "  DATA_ENV=${CURRENT_DATA_ENV} detected. Integration tests require DATA_ENV=sample."
      echo "  Auto-switching to sample environment..."
      scripts/switch-env.sh sample -y
      echo ""
      echo "  Environment switched to sample."
    else
      echo "  ERROR: DATA_ENV=${CURRENT_DATA_ENV} but integration tests require DATA_ENV=sample."
      echo "  Run with --rebuild to auto-switch, or manually: scripts/switch-env.sh sample"
      exit 1
    fi
  fi

  if $REBUILD; then
    # Ensure services are up before freshness check (so it can detect stale containers)
    echo "  Starting services..."
    docker compose up -d --wait
    echo "  Services are healthy."
    echo ""
    # Freshness check + auto-rebuild stale components
    scripts/check-freshness.sh --rebuild
    echo ""
    # Wait again in case rebuild restarted containers
    echo "  Waiting for services to be healthy..."
    docker compose up -d --wait
    echo "  All services are running and healthy."
  else
    scripts/check-freshness.sh

    # Check Docker services are running
    echo ""
    DOCKER_OK=true
    for svc in jupyter-server document-server; do
      if ! is_service_running "$svc"; then
        echo "  ERROR: $svc is not running"
        DOCKER_OK=false
      else
        echo "  OK: $svc is running"
      fi
    done

    if ! $DOCKER_OK; then
      echo ""
      echo "ERROR: Docker services are not running. Start with: docker compose up -d"
      exit 1
    fi
  fi

  # Build MCP servers before integration tests (using rebuild-mcp.sh)
  classify_rebuild_targets
  if [[ ${#MCP_REBUILD_TARGETS[@]} -gt 0 ]]; then
    echo ""
    echo "--- Rebuilding MCP servers ---"
    scripts/rebuild-mcp.sh "${MCP_REBUILD_TARGETS[@]}"
  fi

  echo ""
else
  # Non-integration mode: rebuild if requested
  if $REBUILD; then
    echo "--- Rebuild ---"
    run_rebuild
    echo ""
  fi

  # Warn if Docker is running but stale
  if is_service_running "jupyter-server" || is_service_running "document-server"; then
    scripts/check-freshness.sh 2>/dev/null || true
    echo ""
  fi
fi

FAILED=()

for component in "${TARGETS[@]}"; do
  echo "--- $component ---"

  if [[ "$component" == "hooks" ]]; then
    HOOKS_TEST_DIR=".claude/hooks/tests"
    if [[ ! -d "$HOOKS_TEST_DIR" ]]; then
      echo "  SKIP: directory not found"
      FAILED+=("$component:skip"); continue
    fi
    if $TYPECHECK; then
      echo "  SKIP: typecheck not applicable (shell scripts)"
    fi
    if $TEST; then
      if $INTEGRATION; then
        echo "  SKIP: integration tests not supported for hooks"
      else
        echo "  Running hook tests..."
        HOOKS_TEST_FAILED=false
        shopt -s nullglob
        HOOK_TEST_FILES=("$HOOKS_TEST_DIR"/*.test.sh)
        shopt -u nullglob
        if [[ ${#HOOK_TEST_FILES[@]} -eq 0 ]]; then
          echo "  SKIP: no test files found in $HOOKS_TEST_DIR"
        else
          for test_file in "${HOOK_TEST_FILES[@]}"; do
            echo "  - $(basename "$test_file")"
            if ! bash "$test_file"; then
              HOOKS_TEST_FAILED=true
            fi
            echo ""
          done
        fi
        if $HOOKS_TEST_FAILED; then
          FAILED+=("$component:test"); echo "  FAILED: hook tests"; continue
        fi
        echo "  Test OK"
      fi
    fi
    echo ""
    continue
  fi

  if [[ "$component" == "jupyterlab-ai-sync" ]]; then
    if [[ ! -d "$component" ]]; then
      echo "  SKIP: directory not found"
      FAILED+=("$component:skip"); continue
    fi
    # jupyterlab-ai-sync は npm workspaces 非参加のため node_modules を個別管理する
    if [[ ! -d "$component/node_modules" ]]; then
      echo "  Installing npm dependencies..."
      (cd "$component" && npm install) \
        || { FAILED+=("$component:install"); echo "  FAILED: npm install"; continue; }
    fi
    if $TYPECHECK; then
      echo "  Type checking..."
      (cd "$component" && npx tsc --noEmit) \
        || { FAILED+=("$component:typecheck"); echo "  FAILED: typecheck"; continue; }
      echo "  Typecheck OK"
    fi
    if $TEST; then
      if $INTEGRATION; then
        echo "  SKIP: integration tests not supported for jupyterlab-ai-sync"
      else
        echo "  Building labextension (uv run)..."
        (cd "$component" && uv run --project "$REPO_ROOT" npm run build) \
          || { FAILED+=("$component:test"); echo "  FAILED: build"; continue; }
        echo "  Build OK"
      fi
    fi
    echo ""
    continue
  fi

  if [[ ! -d "$component" ]]; then
    echo "  SKIP: directory not found"
    FAILED+=("$component:skip")
    continue
  fi

  # Detect component type
  if [[ -f "$component/package.json" ]]; then
    PROJECT_TYPE="typescript"
  elif [[ -f "$component/pyproject.toml" ]] || [[ -f "$component/setup.py" ]]; then
    PROJECT_TYPE="python"
  else
    echo "  SKIP: unknown project type"
    FAILED+=("$component:skip")
    continue
  fi

  if $TYPECHECK; then
    echo "  Type checking..."
    if [[ "$PROJECT_TYPE" == "typescript" ]]; then
      (cd "$component" && npm run typecheck) || { FAILED+=("$component:typecheck"); echo "  FAILED: typecheck"; continue; }
    else
      if [[ -d "$component/src" ]]; then
        uv run mypy "$component/src" || { FAILED+=("$component:typecheck"); echo "  FAILED: typecheck"; continue; }
      else
        echo "  SKIP: no src/ directory"
      fi
    fi
    echo "  Typecheck OK"
  fi

  if $TEST; then
    if $INTEGRATION; then
      # Integration test mode
      echo "  Integration testing..."
      if [[ "$PROJECT_TYPE" == "typescript" ]]; then
        if grep -q '"test:integration"' "$component/package.json" 2>/dev/null; then
          (cd "$component" && npm run test:integration) || { FAILED+=("$component:integration"); echo "  FAILED: integration test"; continue; }
        else
          echo "  SKIP: no test:integration script"
        fi
      else
        echo "  SKIP: integration tests not supported for $PROJECT_TYPE"
      fi
      echo "  Integration Test OK"
    else
      # Unit test mode (default)
      echo "  Testing..."
      if [[ "$PROJECT_TYPE" == "typescript" ]]; then
        (cd "$component" && npm test) || { FAILED+=("$component:test"); echo "  FAILED: test"; continue; }
      else
        (cd "$component" && uv run --project "$REPO_ROOT" pytest) || { FAILED+=("$component:test"); echo "  FAILED: test"; continue; }
      fi
      echo "  Test OK"
    fi
  fi

  echo ""
done

echo "=== Result ==="
if [[ ${#FAILED[@]} -eq 0 ]]; then
  echo "All targets passed."
else
  if $HEALTH; then
    if ! command -v jq >/dev/null 2>&1; then
      echo "ERROR: --health は jq を必要とします。sudo apt-get install -y jq / brew install jq でインストールしてください。" >&2
      exit 1
    fi
    # Classify failures against known-failures.json
    KF_FILE="tests/known-failures.json"
    KNOWN=()
    NEW=()

    for failure in "${FAILED[@]}"; do
      # Extract component and phase from "component:phase" format
      failure_comp="${failure%%:*}"
      failure_phase="${failure#*:}"
      if [[ "$failure_comp" == "$failure_phase" ]]; then
        # No phase separator — treat as general failure
        failure_phase=""
      fi

      if [[ -f "$KF_FILE" ]] && [[ -n "$failure_phase" ]]; then
        count=$(jq --arg comp "$failure_comp" --arg phase "$failure_phase" \
          '[.failures[] | select(.component == $comp and .phase == $phase)] | length' "$KF_FILE")
        if [[ "$count" -gt 0 ]]; then
          KNOWN+=("$failure")
        else
          NEW+=("$failure")
        fi
      else
        NEW+=("$failure")
      fi
    done

    echo ""
    if [[ ${#KNOWN[@]} -gt 0 ]]; then
      echo "KNOWN FAILURES (${#KNOWN[@]}): ${KNOWN[*]}"
    fi
    if [[ ${#NEW[@]} -gt 0 ]]; then
      echo "NEW FAILURES (${#NEW[@]}): ${NEW[*]}"
      exit 1
    else
      echo "All failures are known. No new issues."
      exit 0
    fi
  else
    echo "FAILED: ${FAILED[*]}"
    exit 1
  fi
fi
