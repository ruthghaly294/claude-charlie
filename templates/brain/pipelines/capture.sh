#!/usr/bin/env bash
# pipelines/capture.sh — classify input, route to adapter, return the new file path.
# Required env: BRAIN_VAULT, BRAIN_INBOX
# Args: $1 = input (URL, file path, or plain text). For text, can also be passed via stdin.
# Output: prints absolute path of the captured note.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib/log.sh"
# shellcheck disable=SC1091
source "$HERE/../lib/classify.sh"

input="${1:-}"
if [ -z "$input" ] && ! [ -t 0 ]; then
  input="$(cat)"
fi
[ -n "$input" ] || log_die "capture: empty input"

kind="$(classify "$input")"

case "$kind" in
  url)
    "$HERE/../adapters/defuddle.sh" "$input"
    ;;
  copy)
    : "${BRAIN_VAULT:?BRAIN_VAULT must be set}"
    : "${BRAIN_INBOX:=00-Inbox}"
    target_dir="$BRAIN_VAULT/$BRAIN_INBOX"
    mkdir -p "$target_dir"
    base="$(basename "$input")"
    target="$target_dir/$base"
    i=1
    while [ -e "$target" ]; do
      target="$target_dir/${base%.md}-$i.md"
      i=$((i + 1))
    done
    if head -1 "$input" | grep -q '^---$'; then
      cp "$input" "$target.tmp" && mv "$target.tmp" "$target"
    else
      tmp="$target.tmp"
      {
        printf -- '---\n'
        printf 'source: %s\n' "$input"
        printf 'captured_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        printf 'type: md\n'
        printf 'tags: [inbox]\n'
        printf -- '---\n\n'
        cat "$input"
      } > "$tmp"
      mv "$tmp" "$target"
    fi
    echo "$target"
    ;;
  markitdown)
    "$HERE/../adapters/markitdown.sh" "$input"
    ;;
  text)
    printf '%s\n' "$input" | "$HERE/../adapters/text.sh"
    ;;
  *)
    log_die "capture: unknown classification: $kind"
    ;;
esac
