#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

resolve_codex() {
  local bin
  # 1. Already set in environment
  [[ -n "${CODEX_PATH:-}" ]] && { printf '%s' "$CODEX_PATH"; return 0; }
  # 2. On PATH
  bin="$(command -v codex 2>/dev/null || true)"
  [[ -n "$bin" ]] && { printf '%s' "$bin"; return 0; }
  # 3. Common install locations
  local candidates=(
    "$HOME/.local/bin/codex"
    "/usr/local/bin/codex"
    "/opt/homebrew/bin/codex"
    "/usr/bin/codex"
  )
  for c in "${candidates[@]}"; do
    [[ -x "$c" ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

CODEX_PATH="$(resolve_codex || true)"
if [[ -z "${CODEX_PATH:-}" ]]; then
  echo "[codex] 'codex' not found. Install with: npm i -g @openai/codex  or  brew install --cask codex" >&2
  exit 1
fi
export CODEX_PATH

resolve_node() {
  local bin
  bin="$(command -v node 2>/dev/null || true)"
  if [[ -n "$bin" ]]; then
    printf '%s' "$bin"
    return 0
  fi

  local nvm_dirs=()
  [[ -n "${NVM_DIR:-}" ]] && nvm_dirs+=("$NVM_DIR")
  nvm_dirs+=("$HOME/.nvm")
  nvm_dirs+=("${XDG_CONFIG_HOME:-$HOME/.config}/nvm")

  local d nvm_sh
  for d in "${nvm_dirs[@]}"; do
    nvm_sh="${d%/}/nvm.sh"
    if [[ -s "$nvm_sh" ]]; then
      export NVM_DIR="${d%/}"
      \. "$NVM_DIR/nvm.sh" --no-use
      bin="$(command -v node 2>/dev/null || true)"
      if [[ -z "$bin" ]]; then
        bin="$(nvm which current 2>/dev/null || true)"
      fi
      if [[ -n "$bin" ]]; then
        printf '%s' "$bin"
        return 0
      fi
    fi
  done

  return 1
}

NODE="$(resolve_node || true)"
if [[ -z "${NODE:-}" ]]; then
  echo "[codex] node not found in PATH; install Node or ensure nvm is under \"\$HOME\"." >&2
  exit 1
fi

exec "$NODE" "$DIR/server/index.js"
