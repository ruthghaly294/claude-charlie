#!/usr/bin/env bash
# adapters/text.sh — read text on stdin, write a markdown note in $BRAIN_VAULT/$BRAIN_INBOX.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Output: prints absolute path of written file.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"

input="$(cat)"
[ -n "$input" ] || { echo "adapter_text: empty input" >&2; exit 1; }

first_line="$(printf '%s\n' "$input" | head -1)"
slug="$(printf '%s' "$first_line" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)"
[ -n "$slug" ] || slug="note"

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

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: stdin\n'
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: text\n'
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$input"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
