#!/usr/bin/env bash
# adapters/defuddle.sh — fetch a URL (or local HTML file) via defuddle, write markdown to $BRAIN_VAULT/$BRAIN_INBOX.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Args: $1 = URL (http:// or https://) or path to .html file
# Output: prints absolute path of written markdown.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"

src="${1:-}"
[ -n "$src" ] || { echo "adapter_defuddle: missing source arg" >&2; exit 2; }

case "$src" in
  http://*|https://*) : ;;
  *)
    [ -f "$src" ] || { echo "adapter_defuddle: not a URL or file: $src" >&2; exit 2; }
    ;;
esac

command -v defuddle >/dev/null || { echo "adapter_defuddle: defuddle not installed" >&2; exit 1; }

if [[ "$src" =~ ^https?:// ]]; then
  host_path="$(printf '%s' "$src" | sed -E 's,^https?://,,; s,/,-,g; s,[^a-zA-Z0-9-],,g' | cut -c1-60)"
else
  host_path="$(basename "${src%.*}")"
fi
[ -n "$host_path" ] || host_path="page"
slug="$(printf '%s' "$host_path" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)"
[ -n "$slug" ] || slug="page"

date_prefix="$(date -u +%Y-%m-%d)"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
mkdir -p "$target_dir"

base="$date_prefix-$slug"
target="$target_dir/$base.md"
i=1
while [ -e "$target" ]; do
  target="$target_dir/$base-$i.md"
  i=$((i + 1))
done

body="$(defuddle parse "$src" -m 2>/dev/null)" || {
  echo "adapter_defuddle: defuddle failed on $src" >&2
  exit 1
}

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: %s\n' "$src"
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: url\n'
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$body"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
