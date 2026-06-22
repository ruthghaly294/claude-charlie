#!/usr/bin/env bash
# scanners/youtube.sh — emit NDJSON of videos matching configured search queries,
# via yt-dlp's search. Skips gracefully if yt-dlp is not installed.
# Reads: $DECODE_CONFIG_PATH (.sources.youtube.queries[]).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v yt-dlp >/dev/null || { log_warn "youtube: yt-dlp not installed — skipping" >&2; exit 0; }
command -v jq >/dev/null     || { log_warn "youtube: jq not installed — skipping" >&2; exit 0; }
command -v yq >/dev/null     || { log_warn "youtube: yq not installed — skipping" >&2; exit 0; }

mapfile -t queries < <(yq -r '.sources.youtube.queries[]?' "$DECODE_CONFIG_PATH" 2>/dev/null || true)
[ "${#queries[@]}" -gt 0 ] || { log_warn "youtube: no queries configured — skipping" >&2; exit 0; }

for q in "${queries[@]}"; do
  [ -n "$q" ] && [ "$q" != "null" ] || continue
  while IFS=$'\t' read -r title url; do
    [ -n "$url" ] || continue
    jq -nc --arg t "$title" --arg u "$url" '{
      source: "youtube", title: $t, url: $u,
      published: "", author: "", tags: ["youtube"], raw: ""
    }'
  done < <(yt-dlp "ytsearch5:${q}" --flat-playlist \
             --print "%(title)s	%(webpage_url)s" 2>/dev/null || true)
done
