#!/usr/bin/env bash

# Token Tracker — Shell Aliases for Output Compression
# Source this file before starting Claude Code:
#   source ~/Desktop/token-tracker/shell/aliases.sh
#
# All aliased commands pipe their output through the compressor,
# reducing tokens sent to the LLM while preserving useful info.

# Auto-detect the project root (where this script lives)
TOKENTRACKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPRESS="node ${TOKENTRACKER_DIR}/bin/compress.js"

# All commands to wrap — single source of truth for aliases and tt_off
_TT_COMMANDS=(
  git
  npm yarn pnpm npx
  docker docker-compose podman
  dotnet msbuild
  ng
  tsc eslint htmlhint prettier cargo
  azurite
  pip pip3 python python3
  az
  terraform
  sqlcmd sqlpackage
  kubectl helm
  curl
)

# Helper: wrap a command so its output is piped through the compressor
_tt_wrap() {
  local cmd="$1"
  shift
  local full_cmd="$cmd $*"

  # Run the real command + pipe through compressor
  command "$cmd" "$@" 2>&1 | $COMPRESS "$full_cmd"
}

# Register all aliases from the list
for _cmd in "${_TT_COMMANDS[@]}"; do
  alias "$_cmd=_tt_wrap $_cmd"
done
unset _cmd

# --- Control ---
# Temporarily disable compression
tt_off() {
  for _cmd in "${_TT_COMMANDS[@]}"; do
    unalias "$_cmd" 2>/dev/null
  done
  unset _cmd
  echo "  Token compression disabled."
}

# Re-enable compression
tt_on() {
  source "${BASH_SOURCE[0]}"
  echo "  Token compression enabled."
}

# Bypass compression for a single command: tt_raw git status
tt_raw() {
  command "$@"
}

echo "  Token Tracker compression active. Use tt_off to disable, tt_raw <cmd> for bypass."
