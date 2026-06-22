#!/usr/bin/env bash
# scanners/rss.sh — emit NDJSON signal records from configured RSS/Atom feeds.
# Reads: $DECODE_CONFIG_PATH (.sources.rss[]).  Output: NDJSON on stdout.
# Diagnostics go to stderr so stdout stays clean NDJSON.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v curl >/dev/null    || { log_warn "rss: curl not installed — skipping" >&2; exit 0; }
command -v python3 >/dev/null || { log_warn "rss: python3 not installed — skipping" >&2; exit 0; }
command -v yq >/dev/null      || { log_warn "rss: yq not installed — skipping" >&2; exit 0; }

mapfile -t urls < <(yq -r '.sources.rss[]?' "$DECODE_CONFIG_PATH" 2>/dev/null || true)
[ "${#urls[@]}" -gt 0 ] || { log_warn "rss: no feeds configured — skipping" >&2; exit 0; }

for url in "${urls[@]}"; do
  [ -n "$url" ] && [ "$url" != "null" ] || continue
  body="$(curl -fsSL "$url" 2>/dev/null || true)"
  [ -n "$body" ] || { log_warn "rss: fetch failed: $url" >&2; continue; }
  printf '%s' "$body" | python3 "$HERE/rss_parse.py" "$url"
done
