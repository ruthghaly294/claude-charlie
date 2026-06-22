#!/usr/bin/env bash
# scanners/reddit_hn.sh — emit NDJSON from configured subreddits (hot posts) and
# a Hacker News search query (via the public Algolia API). No keys required.
# Reads: $DECODE_CONFIG_PATH (.sources.reddit.subreddits[], .sources.hackernews.query).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v curl >/dev/null || { log_warn "reddit_hn: curl not installed — skipping" >&2; exit 0; }
command -v jq >/dev/null   || { log_warn "reddit_hn: jq not installed — skipping" >&2; exit 0; }
command -v yq >/dev/null   || { log_warn "reddit_hn: yq not installed — skipping" >&2; exit 0; }

UA="decode-bot/1.0 (intelligence scanner)"

mapfile -t subs < <(yq -r '.sources.reddit.subreddits[]?' "$DECODE_CONFIG_PATH" 2>/dev/null || true)
for sub in "${subs[@]}"; do
  [ -n "$sub" ] && [ "$sub" != "null" ] || continue
  body="$(curl -fsSL -H "User-Agent: $UA" \
            "https://www.reddit.com/r/${sub}/hot.json?limit=10" 2>/dev/null || true)"
  [ -n "$body" ] || { log_warn "reddit_hn: fetch failed for r/$sub" >&2; continue; }
  printf '%s' "$body" | jq -c --arg sub "$sub" '
    .data.children[]? | .data | {
      source: "reddit",
      title: (.title // ""),
      url: ("https://www.reddit.com" + (.permalink // "")),
      published: "",
      author: (.author // ""),
      tags: ["reddit", $sub],
      raw: (.selftext // "")
    }' 2>/dev/null || log_warn "reddit_hn: parse failed for r/$sub" >&2
done

query="$(yq -r '.sources.hackernews.query // ""' "$DECODE_CONFIG_PATH" 2>/dev/null || true)"
if [ -n "$query" ] && [ "$query" != "null" ]; then
  body="$(curl -fsSL -G "https://hn.algolia.com/api/v1/search" \
            --data-urlencode "query=${query}" --data "tags=story" \
            2>/dev/null || true)"
  if [ -n "$body" ]; then
    printf '%s' "$body" | jq -c '
      .hits[]? | {
        source: "hackernews",
        title: (.title // ""),
        url: (.url // ("https://news.ycombinator.com/item?id=" + (.objectID // ""))),
        published: "",
        author: (.author // ""),
        tags: ["hackernews"],
        raw: ""
      }' 2>/dev/null || log_warn "reddit_hn: HN parse failed" >&2
  else
    log_warn "reddit_hn: HN fetch failed" >&2
  fi
fi
