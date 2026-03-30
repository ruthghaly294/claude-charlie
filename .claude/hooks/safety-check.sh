#!/bin/bash
# Blocks dangerous bash commands before execution.
# Used as PreToolUse hook with Bash matcher.
# Exit 0 = allow, Exit 2 = block (with stderr as feedback to Claude).

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

BLOCKED_PATTERNS=(
  "rm -rf /"
  "rm -rf /*"
  "git push --force main"
  "git push --force origin main"
  "git push -f main"
  "git push -f origin main"
  "git reset --hard"
  "DROP TABLE"
  "DROP DATABASE"
  "truncate table"
  "mkfs"
  "> /dev/sda"
)

COMMAND_LOWER=$(echo "$COMMAND" | tr '[:upper:]' '[:lower:]')

for pattern in "${BLOCKED_PATTERNS[@]}"; do
  PATTERN_LOWER=$(echo "$pattern" | tr '[:upper:]' '[:lower:]')
  if [[ "$COMMAND_LOWER" == *"$PATTERN_LOWER"* ]]; then
    echo "BLOCKED: Command contains dangerous pattern '$pattern'. This command could cause irreversible damage. Use a safer alternative." >&2
    exit 2
  fi
done

exit 0
