#!/usr/bin/env bash
# hooks/save-conversation.sh — Stop hook that auto-saves a Claude Code transcript
# into the second-brain vault as a markdown note.
#
# Stdin: JSON {session_id, transcript_path, hook_event_name, ...}
# Required env: BRAIN_VAULT (defaults to ~/second-brain)
# Output dir: $BRAIN_VAULT/00-Inbox/conversations/
#
# Idempotent per session_id — re-running on the same session overwrites in place.

set -uo pipefail

BRAIN_VAULT="${BRAIN_VAULT:-$HOME/second-brain}"
INBOX_DIR="$BRAIN_VAULT/00-Inbox/conversations"

# Read stdin (Claude Code passes hook payload as JSON on stdin).
payload="$(cat 2>/dev/null || true)"
[ -n "$payload" ] || exit 0

transcript="$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null || true)"
session_id="$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)"

# No transcript → nothing to save (not an error; some hook events don't carry one).
[ -n "$transcript" ] || exit 0
[ -f "$transcript" ] || exit 0

# Render the transcript as readable markdown.
rendered="$(jq -r '
  select(.type == "user" or .type == "assistant") |
  if .type == "user" then
    "## User\n\n" + (
      if (.message.content | type) == "string" then
        .message.content
      elif (.message.content | type) == "array" then
        (.message.content | map(select(.type == "text") | .text) | join("\n\n"))
      else
        ""
      end
    )
  else
    "## Assistant\n\n" + (
      if (.message.content | type) == "array" then
        (.message.content | map(select(.type == "text") | .text) | join("\n\n"))
      else
        ""
      end
    )
  end
' "$transcript" 2>/dev/null)"

# Empty rendered transcript? Skip.
[ -n "$rendered" ] || exit 0

# Derive a slug from the first user message.
first_user="$(jq -r '
  select(.type == "user") |
  if (.message.content | type) == "string" then
    .message.content
  elif (.message.content | type) == "array" then
    (.message.content | map(select(.type == "text") | .text) | join(" "))
  else
    ""
  end
' "$transcript" 2>/dev/null | grep -v '^$' | head -1)"

slug="$(printf '%s' "$first_user" | tr '[:upper:]' '[:lower:]' \
        | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)"
[ -n "$slug" ] || slug="conversation"

session_short="${session_id:0:8}"
[ -n "$session_short" ] || session_short="$(date +%s)"

mkdir -p "$INBOX_DIR"
date_prefix="$(date -u +%Y-%m-%d)"
captured_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

target="$INBOX_DIR/$date_prefix-$slug-$session_short.md"
tmp="$target.tmp"

{
  printf -- '---\n'
  printf 'source: claude-code-transcript\n'
  printf 'captured_at: %s\n' "$captured_at"
  printf 'type: conversation\n'
  printf 'session_id: %s\n' "${session_id:-unknown}"
  printf 'transcript_path: %s\n' "$transcript"
  printf 'tags: [inbox, conversation]\n'
  printf -- '---\n\n'
  printf '# %s\n\n' "$first_user"
  printf '%s\n' "$rendered"
} > "$tmp"
mv "$tmp" "$target"

# Hooks should not block Claude Code on errors — always exit 0.
exit 0
