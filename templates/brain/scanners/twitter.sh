#!/usr/bin/env bash
# scanners/twitter.sh — emit NDJSON from X/Twitter recent search (API v2).
# Gated on .sources.twitter.enabled AND env TWITTER_BEARER.
# Query = business keywords joined with OR.  Skips gracefully when not configured.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v yq >/dev/null   || { log_warn "twitter: yq missing — skipping" >&2; exit 0; }
command -v jq >/dev/null   || { log_warn "twitter: jq missing — skipping" >&2; exit 0; }
command -v curl >/dev/null || { log_warn "twitter: curl missing — skipping" >&2; exit 0; }

[ "$(yq -r '.sources.twitter.enabled // false' "$DECODE_CONFIG_PATH")" = "true" ] \
  || { log_warn "twitter: disabled in config — skipping" >&2; exit 0; }
[ -n "${TWITTER_BEARER:-}" ] \
  || { log_warn "twitter: TWITTER_BEARER not set — skipping" >&2; exit 0; }

q="$(yq -r '.business.keywords // [] | join(" OR ")' "$DECODE_CONFIG_PATH")"
[ -n "$q" ] && [ "$q" != "null" ] || q="$(yq -r '.business.name // ""' "$DECODE_CONFIG_PATH")"
[ -n "$q" ] || { log_warn "twitter: no query — skipping" >&2; exit 0; }

body="$(curl -fsSL -G "https://api.twitter.com/2/tweets/search/recent" \
          -H "Authorization: Bearer $TWITTER_BEARER" \
          --data-urlencode "query=$q -is:retweet lang:en" \
          --data "max_results=10" \
          --data "tweet.fields=author_id,created_at" 2>/dev/null || true)"
[ -n "$body" ] || { log_warn "twitter: fetch failed" >&2; exit 0; }

printf '%s' "$body" | jq -c '
  .data[]? | {
    source: "twitter",
    title: ((.text // "") | gsub("\n"; " ") | .[0:80]),
    url: ("https://twitter.com/i/web/status/" + (.id // "")),
    published: (.created_at // ""),
    author: (.author_id // ""),
    tags: ["twitter"],
    raw: (.text // "")
  }' 2>/dev/null || log_warn "twitter: parse failed" >&2
