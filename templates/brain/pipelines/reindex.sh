#!/usr/bin/env bash
# pipelines/reindex.sh — run qmd embed and graphify --update against the vault.
# Required env: BRAIN_VAULT
# Exit code: 0 only if both succeeded; 1 if either failed.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"

qmd_status=0
graphify_status=0

log_step "Reindex (1/2) — qmd embed"
if command -v qmd >/dev/null; then
  (cd "$BRAIN_VAULT" && qmd embed) || qmd_status=$?
else
  log_warn "qmd not installed — skipping"
  qmd_status=127
fi

log_step "Reindex (2/2) — graphify --update --obsidian"
if command -v graphify >/dev/null; then
  graphify "$BRAIN_VAULT" --update --obsidian --obsidian-dir "$BRAIN_VAULT" || graphify_status=$?
else
  log_warn "graphify not installed — skipping"
  graphify_status=127
fi

mkdir -p "$BRAIN_VAULT/.graphify-out"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BRAIN_VAULT/.graphify-out/last_reindex.txt" 2>/dev/null || true

if [ "$qmd_status" -eq 0 ] && [ "$graphify_status" -eq 0 ]; then
  log_ok "reindex complete"
  exit 0
fi
log_fail "reindex failures: qmd=$qmd_status graphify=$graphify_status"
exit 1
