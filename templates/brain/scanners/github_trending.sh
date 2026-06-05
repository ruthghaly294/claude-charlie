#!/usr/bin/env bash
# scanners/github_trending.sh — emit NDJSON for recently-created, high-star repos
# per configured topic, via the public GitHub search API (rate-limited, no key).
# Reads: $DECODE_CONFIG_PATH (.sources.github_trending.{topics[],window}).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set}"
command -v curl >/dev/null || { log_warn "github: curl not installed — skipping" >&2; exit 0; }
command -v jq >/dev/null   || { log_warn "github: jq not installed — skipping" >&2; exit 0; }
command -v yq >/dev/null   || { log_warn "github: yq not installed — skipping" >&2; exit 0; }

mapfile -t topics < <(yq -r '.sources.github_trending.topics[]?' "$DECODE_CONFIG_PATH" 2>/dev/null || true)
[ "${#topics[@]}" -gt 0 ] || { log_warn "github: no topics configured — skipping" >&2; exit 0; }

window="$(yq -r '.sources.github_trending.window // "weekly"' "$DECODE_CONFIG_PATH")"
case "$window" in
  daily) days=1 ;; monthly) days=30 ;; *) days=7 ;;
esac
since="$(date -u -d "-${days} days" +%Y-%m-%d 2>/dev/null || date -u +%Y-%m-%d)"

for topic in "${topics[@]}"; do
  [ -n "$topic" ] && [ "$topic" != "null" ] || continue
  body="$(curl -fsSL -G "https://api.github.com/search/repositories" \
            -H "Accept: application/vnd.github+json" \
            --data-urlencode "q=topic:${topic} created:>${since}" \
            --data "sort=stars" --data "order=desc" --data "per_page=10" \
            2>/dev/null || true)"
  [ -n "$body" ] || { log_warn "github: fetch failed for topic $topic" >&2; continue; }
  printf '%s' "$body" | jq -c --arg topic "$topic" '
    .items[]? | {
      source: "github",
      title: .full_name,
      url: .html_url,
      published: "",
      author: (.owner.login // ""),
      tags: ["github", $topic],
      raw: ((.description // "") + " ★" + ((.stargazers_count // 0)|tostring))
    }' 2>/dev/null || log_warn "github: parse failed for topic $topic" >&2
done
