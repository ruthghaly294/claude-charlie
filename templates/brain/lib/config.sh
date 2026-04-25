#!/usr/bin/env bash
# Loads brain.config.yml and exports BRAIN_* env vars.
# Source-only; do not execute directly.
# Requires: yq (mikefarah)

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/log.sh"

config_load() {
  local config_path="${1:-$HOME/second-brain/brain.config.yml}"

  if [ ! -f "$config_path" ]; then
    log_fail "config not found: $config_path"
    return 1
  fi

  command -v yq >/dev/null || { log_fail "yq is required but not installed"; return 1; }

  local raw_vault inbox sources graphs gmode whisper preserve attach
  raw_vault="$(yq '.vault' "$config_path")"
  inbox="$(yq '.inbox' "$config_path")"
  sources="$(yq '.sources' "$config_path")"
  graphs="$(yq '.graphs' "$config_path")"
  gmode="$(yq '.graphify.mode // "standard"' "$config_path")"
  whisper="$(yq '.graphify.whisper_model // "base"' "$config_path")"
  preserve="$(yq '.markitdown.preserve_originals // true' "$config_path")"
  attach="$(yq '.markitdown.attachments_dir // "10-Sources/_attachments"' "$config_path")"

  if [ "$raw_vault" = "null" ] || [ -z "$raw_vault" ]; then
    log_fail "config missing required key: vault"
    return 1
  fi

  case "$raw_vault" in
    "~"|"~/"*) raw_vault="${HOME}${raw_vault:1}" ;;
  esac

  export BRAIN_VAULT="$raw_vault"
  export BRAIN_INBOX="${inbox:-00-Inbox}"
  export BRAIN_SOURCES="${sources:-10-Sources}"
  export BRAIN_GRAPHS="${graphs:-90-Graphs}"
  export BRAIN_GRAPHIFY_MODE="$gmode"
  export BRAIN_GRAPHIFY_WHISPER="$whisper"
  export BRAIN_MARKITDOWN_PRESERVE="$preserve"
  export BRAIN_MARKITDOWN_ATTACHMENTS="$attach"
}
