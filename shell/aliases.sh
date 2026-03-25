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

# Helper: wrap a command so its output is piped through the compressor
_tt_wrap() {
  local cmd="$1"
  shift
  local full_cmd="$cmd $*"

  # Run the real command + pipe through compressor
  command "$cmd" "$@" 2>&1 | $COMPRESS "$full_cmd"
}

# --- Git ---
alias git='_tt_wrap git'

# --- npm/yarn/pnpm ---
alias npm='_tt_wrap npm'
alias yarn='_tt_wrap yarn'
alias pnpm='_tt_wrap pnpm'
alias npx='_tt_wrap npx'

# --- Docker ---
alias docker='_tt_wrap docker'
alias docker-compose='_tt_wrap docker-compose'

# --- .NET ---
alias dotnet='_tt_wrap dotnet'
alias msbuild='_tt_wrap msbuild'

# --- Angular ---
alias ng='_tt_wrap ng'

# --- Build / Lint tools ---
alias tsc='_tt_wrap tsc'
alias eslint='_tt_wrap eslint'
alias htmlhint='_tt_wrap htmlhint'
alias prettier='_tt_wrap prettier'
alias cargo='_tt_wrap cargo'

# --- Azure Storage Emulator ---
alias azurite='_tt_wrap azurite'

# --- Python ---
alias pip='_tt_wrap pip'
alias pip3='_tt_wrap pip3'
alias python='_tt_wrap python'
alias python3='_tt_wrap python3'

# --- Azure CLI ---
alias az='_tt_wrap az'

# --- Terraform ---
alias terraform='_tt_wrap terraform'

# --- SQL ---
alias sqlcmd='_tt_wrap sqlcmd'
alias sqlpackage='_tt_wrap sqlpackage'

# --- Kubernetes ---
alias kubectl='_tt_wrap kubectl'
alias helm='_tt_wrap helm'

# --- General ---
alias curl='_tt_wrap curl'

# --- Control ---
# Temporarily disable compression
tt_off() {
  unalias git npm yarn pnpm npx docker docker-compose dotnet msbuild ng tsc eslint htmlhint prettier cargo azurite pip pip3 python python3 az terraform sqlcmd sqlpackage kubectl helm curl 2>/dev/null
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
