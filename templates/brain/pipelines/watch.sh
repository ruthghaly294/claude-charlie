#!/usr/bin/env bash
# pipelines/watch.sh — watch ~/second-brain/00-Inbox/_dropbox/ for new files.
# Uses inotifywait if available.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

BRAIN_VAULT="${BRAIN_VAULT:-$HOME/second-brain}"
DROPBOX="$BRAIN_VAULT/00-Inbox/_dropbox"

mkdir -p "$DROPBOX"

log_step "Watching $DROPBOX for changes..."

if command -v inotifywait >/dev/null; then
  inotifywait -m -e close_write -e moved_to --format '%f' "$DROPBOX" | while read -r filename; do
    filepath="$DROPBOX/$filename"
    [ -f "$filepath" ] || continue
    log_info "Detected: $filename"
    
    # Capture it
    if "$HERE/../brain" capture "$filepath"; then
      log_ok "Captured $filename"
      rm -f "$filepath"
      
      # Reindex
      "$HERE/../brain" reindex
    else
      log_fail "Failed to capture $filename"
    fi
  done
else
  log_warn "inotifywait not found. Using poll fallback (every 10s)."
  while true; do
    for filepath in "$DROPBOX"/*; do
      [ -f "$filepath" ] || continue
      filename=$(basename "$filepath")
      log_info "Detected: $filename"
      
      if "$HERE/../brain" capture "$filepath"; then
        log_ok "Captured $filename"
        rm -f "$filepath"
        "$HERE/../brain" reindex
      else
        log_fail "Failed to capture $filename"
      fi
    done
    sleep 10
  done
fi
