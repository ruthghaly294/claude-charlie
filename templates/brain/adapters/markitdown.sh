#!/usr/bin/env bash
# adapters/markitdown.sh — convert any file to markdown via markitdown,
# write a note in $BRAIN_VAULT/$BRAIN_INBOX, optionally preserve the original.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Optional env: BRAIN_MARKITDOWN_PRESERVE (default: true), BRAIN_MARKITDOWN_ATTACHMENTS
# Args: $1 = path to source file
# Output: prints absolute path of written markdown.

set -euo pipefail

: "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
: "${BRAIN_INBOX:=00-Inbox}"
: "${BRAIN_MARKITDOWN_PRESERVE:=true}"
: "${BRAIN_MARKITDOWN_ATTACHMENTS:=10-Sources/_attachments}"

src="${1:-}"
[ -n "$src" ] || { echo "adapter_markitdown: missing path arg" >&2; exit 2; }
[ -f "$src" ] || { echo "adapter_markitdown: not a file: $src" >&2; exit 1; }
command -v markitdown >/dev/null || { echo "adapter_markitdown: markitdown not installed" >&2; exit 1; }

abs_src="$(cd "$(dirname "$src")" && pwd)/$(basename "$src")"
ext="${src##*.}"; ext="${ext,,}"
basename_noext="$(basename "${src%.*}")"
slug="$(printf '%s' "$basename_noext" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-60)"
[ -n "$slug" ] || slug="source"

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

original_path=""
if [ "$BRAIN_MARKITDOWN_PRESERVE" = "true" ]; then
  attach_dir="$BRAIN_VAULT/$BRAIN_MARKITDOWN_ATTACHMENTS"
  mkdir -p "$attach_dir"
  cp "$abs_src" "$attach_dir/"
  original_path="$BRAIN_MARKITDOWN_ATTACHMENTS/$(basename "$abs_src")"
fi

body="$(markitdown "$abs_src" 2>/dev/null)" || {
  echo "adapter_markitdown: markitdown failed on $abs_src" >&2
  exit 1
}

tmp="$target.tmp"
{
  printf -- '---\n'
  printf 'source: %s\n' "$abs_src"
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: %s\n' "$ext"
  [ -n "$original_path" ] && printf 'original_path: %s\n' "$original_path"
  printf 'tags: [inbox]\n'
  printf -- '---\n\n'
  printf '%s\n' "$body"
} > "$tmp"
mv "$tmp" "$target"

echo "$target"
