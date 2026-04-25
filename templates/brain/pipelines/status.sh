#!/usr/bin/env bash
# pipelines/status.sh — print vault stats.
# Required env: BRAIN_VAULT, BRAIN_INBOX, BRAIN_SOURCES, BRAIN_GRAPHS

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"
: "${BRAIN_SOURCES:=10-Sources}"
: "${BRAIN_GRAPHS:=90-Graphs}"

count_md() {
  local d="$1"
  [ -d "$d" ] || { echo 0; return; }
  find "$d" -maxdepth 4 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' '
}

log_step "Brain status — $BRAIN_VAULT"
echo "  Inbox    : $(count_md "$BRAIN_VAULT/$BRAIN_INBOX") notes"
echo "  Sources  : $(count_md "$BRAIN_VAULT/$BRAIN_SOURCES") notes"
echo "  Notes    : $(count_md "$BRAIN_VAULT/20-Notes") notes"
echo "  Graphs   : $(count_md "$BRAIN_VAULT/$BRAIN_GRAPHS") notes"

if [ -f "$BRAIN_VAULT/.graphify-out/last_reindex.txt" ]; then
  echo "  Last reindex: $(cat "$BRAIN_VAULT/.graphify-out/last_reindex.txt")"
else
  echo "  Last reindex: never"
fi

if command -v qmd >/dev/null; then
  echo "  qmd      : $(qmd --version 2>/dev/null | head -1) [installed]"
else
  echo "  qmd      : NOT installed"
fi

if command -v graphify >/dev/null; then
  echo "  graphify : installed"
else
  echo "  graphify : NOT installed"
fi

if command -v markitdown >/dev/null; then
  echo "  markitdown : installed"
else
  echo "  markitdown : NOT installed"
fi
