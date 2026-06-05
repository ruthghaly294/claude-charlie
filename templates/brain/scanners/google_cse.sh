#!/usr/bin/env bash
# scanners/google_cse.sh — emit NDJSON from Google Custom Search.
# Gated on .sources.google_cse.enabled AND env GOOGLE_CSE_KEY + GOOGLE_CSE_ID.
# Query = business keywords joined with OR.  Skips gracefully when not configured.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v yq >/dev/null   || { log_warn "google_cse: yq missing — skipping" >&2; exit 0; }
command -v jq >/dev/null   || { log_warn "google_cse: jq missing — skipping" >&2; exit 0; }
command -v curl >/dev/null || { log_warn "google_cse: curl missing — skipping" >&2; exit 0; }

[ "$(yq -r '.sources.google_cse.enabled // false' "$DECODE_CONFIG_PATH")" = "true" ] \
  || { log_warn "google_cse: disabled in config — skipping" >&2; exit 0; }
[ -n "${GOOGLE_CSE_KEY:-}" ] && [ -n "${GOOGLE_CSE_ID:-}" ] \
  || { log_warn "google_cse: GOOGLE_CSE_KEY / GOOGLE_CSE_ID not set — skipping" >&2; exit 0; }

q="$(yq -r '.business.keywords // [] | join(" OR ")' "$DECODE_CONFIG_PATH")"
[ -n "$q" ] && [ "$q" != "null" ] || q="$(yq -r '.business.name // ""' "$DECODE_CONFIG_PATH")"
[ -n "$q" ] || { log_warn "google_cse: no query (keywords/name) — skipping" >&2; exit 0; }

body="$(curl -fsSL -G "https://www.googleapis.com/customsearch/v1" \
          --data-urlencode "key=$GOOGLE_CSE_KEY" \
          --data-urlencode "cx=$GOOGLE_CSE_ID" \
          --data-urlencode "q=$q" 2>/dev/null || true)"
[ -n "$body" ] || { log_warn "google_cse: fetch failed" >&2; exit 0; }

printf '%s' "$body" | jq -c '
  .items[]? | {
    source: "google",
    title: (.title // ""),
    url: (.link // ""),
    published: "",
    author: (.displayLink // ""),
    tags: ["google"],
    raw: (.snippet // "")
  }' 2>/dev/null || log_warn "google_cse: parse failed" >&2
