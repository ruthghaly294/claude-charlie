#!/usr/bin/env bash
# pipelines/discover.sh — Discover stage. Collect NDJSON signal records (from the
# scanners, or from stdin with --stdin) and write one markdown note per new
# signal into $DECODE_VAULT/$DECODE_SIGNALS, deduped via a .seen ledger.
#
# Required env: DECODE_VAULT (+ DECODE_CONFIG_PATH when running scanners).
# Usage: discover.sh [--stdin]
# Output: prints the path of each newly-written signal note.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"

: "${DECODE_VAULT:?DECODE_VAULT must be set}"
: "${DECODE_SIGNALS:=01-Signals}"
command -v jq >/dev/null || log_die "discover: jq is required"

signals_dir="$DECODE_VAULT/$DECODE_SIGNALS"
seen="$signals_dir/.seen"
mkdir -p "$signals_dir"
touch "$seen"

SCANNERS=(rss github_trending reddit_hn youtube google_cse twitter producthunt)

_hash() { printf '%s' "$1" | sha1sum | cut -d' ' -f1; }

_slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-50
}

# double-quote + escape a value for safe YAML frontmatter
_yaml_dq() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')"
}

run_scanners() {
  : "${DECODE_CONFIG_PATH:?DECODE_CONFIG_PATH must be set to run scanners}"
  local s
  for s in "${SCANNERS[@]}"; do
    [ -x "$HERE/../scanners/$s.sh" ] || continue
    "$HERE/../scanners/$s.sh" || log_warn "discover: scanner '$s' exited non-zero" >&2
  done
}

write_signal() {
  local line="$1"
  local url title source published author tags raw
  url="$(printf '%s' "$line"       | jq -r '.url // ""')"
  title="$(printf '%s' "$line"     | jq -r '.title // ""')"
  source="$(printf '%s' "$line"    | jq -r '.source // "unknown"')"
  published="$(printf '%s' "$line" | jq -r '.published // ""')"
  author="$(printf '%s' "$line"    | jq -r '.author // ""')"
  tags="$(printf '%s' "$line"      | jq -r '(.tags // []) | join(", ")')"
  raw="$(printf '%s' "$line"       | jq -r '.raw // ""')"

  [ -n "$url" ] || [ -n "$title" ] || return 0

  local h; h="$(_hash "${url:-$title}")"
  grep -qxF "$h" "$seen" 2>/dev/null && return 0

  local slug; slug="$(_slugify "${title:-$source}")"; [ -n "$slug" ] || slug="signal"
  local base target i
  base="$(date -u +%Y-%m-%d)-$slug"
  target="$signals_dir/$base.md"; i=1
  while [ -e "$target" ]; do target="$signals_dir/$base-$i.md"; i=$((i + 1)); done

  {
    printf -- '---\n'
    printf 'source: %s\n' "$source"
    printf 'title: %s\n' "$(_yaml_dq "$title")"
    printf 'url: %s\n' "$url"
    printf 'published: %s\n' "$(_yaml_dq "$published")"
    printf 'author: %s\n' "$(_yaml_dq "$author")"
    printf 'captured_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'tags: [signal, %s]\n' "$source"
    printf 'score: null\n'
    printf 'cluster: null\n'
    printf -- '---\n\n'
    printf '# %s\n\n' "$title"
    [ -n "$url" ] && printf '<%s>\n\n' "$url"
    [ -n "$tags" ] && printf '*tags: %s*\n\n' "$tags"
    printf '%s\n' "$raw"
  } > "$target.tmp"
  mv "$target.tmp" "$target"
  printf '%s\n' "$h" >> "$seen"
  echo "$target"
}

mode="${1:-}"
written="$(mktemp)"

emit() {
  if [ "$mode" = "--stdin" ]; then cat; else run_scanners; fi
}

emit | while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] || continue
  write_signal "$line" >> "$written" || true
done

n="$(grep -c . "$written" 2>/dev/null || true)"; n="${n:-0}"
log_step "Discover — wrote $n new signal(s) → $DECODE_SIGNALS/" >&2
cat "$written"
rm -f "$written"
