#!/usr/bin/env bash
# scanners/producthunt.sh — emit NDJSON of recent Product Hunt launches via the
# v2 GraphQL API.  Gated on .sources.producthunt.enabled AND env PRODUCTHUNT_TOKEN.
# Skips gracefully when not configured.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v yq >/dev/null   || { log_warn "producthunt: yq missing — skipping" >&2; exit 0; }
command -v jq >/dev/null   || { log_warn "producthunt: jq missing — skipping" >&2; exit 0; }
command -v curl >/dev/null || { log_warn "producthunt: curl missing — skipping" >&2; exit 0; }

[ "$(yq -r '.sources.producthunt.enabled // false' "$DECODE_CONFIG_PATH")" = "true" ] \
  || { log_warn "producthunt: disabled in config — skipping" >&2; exit 0; }
[ -n "${PRODUCTHUNT_TOKEN:-}" ] \
  || { log_warn "producthunt: PRODUCTHUNT_TOKEN not set — skipping" >&2; exit 0; }

query='{ "query": "{ posts(order: VOTES, first: 10) { edges { node { name tagline url votesCount } } } }" }'

body="$(curl -fsSL "https://api.producthunt.com/v2/api/graphql" \
          -H "Authorization: Bearer $PRODUCTHUNT_TOKEN" \
          -H "Content-Type: application/json" \
          -d "$query" 2>/dev/null || true)"
[ -n "$body" ] || { log_warn "producthunt: fetch failed" >&2; exit 0; }

printf '%s' "$body" | jq -c '
  .data.posts.edges[]? | .node | {
    source: "producthunt",
    title: (.name // ""),
    url: (.url // ""),
    published: "",
    author: "",
    tags: ["producthunt"],
    raw: ((.tagline // "") + " ▲" + ((.votesCount // 0)|tostring))
  }' 2>/dev/null || log_warn "producthunt: parse failed" >&2
