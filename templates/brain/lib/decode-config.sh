#!/usr/bin/env bash
# Loads decode.config.yml and exports DECODE_* env vars.
# Also exports the BRAIN_* vars that inline brain adapter/pipeline calls require.
# Source-only; do not execute directly.
# Requires: yq (mikefarah)

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "${BASH_SOURCE[0]}")/log.sh"

# expand a leading ~ to $HOME
_decode_expand_home() {
  local p="$1"
  case "$p" in
    "~"|"~/"*) printf '%s' "${HOME}${p:1}" ;;
    *) printf '%s' "$p" ;;
  esac
}

decode_config_load() {
  local config_path="${1:-$HOME/second-brain/decode.config.yml}"

  if [ ! -f "$config_path" ]; then
    log_fail "config not found: $config_path"
    return 1
  fi

  command -v yq >/dev/null || { log_fail "yq is required but not installed"; return 1; }

  local name desc vault threshold top_n
  name="$(yq '.business.name // ""' "$config_path")"
  if [ -z "$name" ] || [ "$name" = "null" ]; then
    log_fail "config missing required key: business.name"
    return 1
  fi

  vault="$(yq '.vault // "~/second-brain"' "$config_path")"
  desc="$(yq '.business.description // ""' "$config_path")"
  threshold="$(yq '.scoring.keep_threshold // 0.35' "$config_path")"
  top_n="$(yq '.execute.top_n // 3' "$config_path")"

  export DECODE_CONFIG_PATH="$config_path"
  export DECODE_VAULT
  DECODE_VAULT="$(_decode_expand_home "$vault")"
  export DECODE_BUSINESS_NAME="$name"
  export DECODE_BUSINESS_DESC="$desc"
  export DECODE_KEEP_THRESHOLD="$threshold"
  export DECODE_TOP_N="$top_n"

  # newline-separated lists (empty string when absent)
  export DECODE_KEYWORDS
  DECODE_KEYWORDS="$(yq -r '.business.keywords[]?' "$config_path" 2>/dev/null || true)"
  export DECODE_COMPETITORS
  DECODE_COMPETITORS="$(yq -r '.business.competitors[]?' "$config_path" 2>/dev/null || true)"

  # DECODE vault folder conventions (not user-configurable in MVP)
  export DECODE_SIGNALS="01-Signals"
  export DECODE_INSIGHTS="25-Insights"
  export DECODE_DECISIONS="50-Decisions"
  export DECODE_EXECUTION="60-Execution"
  export DECODE_FEEDBACK="70-Feedback"

  # Make inline brain adapter/pipeline calls (capture, reindex) work against the
  # same vault without a separate brain.config.yml load.
  export BRAIN_VAULT="$DECODE_VAULT"
  export BRAIN_INBOX="${BRAIN_INBOX:-00-Inbox}"
  export BRAIN_SOURCES="${BRAIN_SOURCES:-10-Sources}"
  export BRAIN_GRAPHS="${BRAIN_GRAPHS:-90-Graphs}"
}
