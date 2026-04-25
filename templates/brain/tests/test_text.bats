#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_text writes a markdown file with frontmatter" {
  echo "Hello brain" | "$ROOT/adapters/text.sh"
  count=$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md 2>/dev/null | wc -l)
  [ "$count" -eq 1 ]
}

@test "adapter_text frontmatter includes type:text and source" {
  echo "First line is the title" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  grep -q '^type: text$' "$file"
  grep -q '^source: stdin$' "$file"
  grep -q '^captured_at: ' "$file"
}

@test "adapter_text slug derives from first line" {
  echo "My grand idea today" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  [[ "$(basename "$file")" == *"my-grand-idea-today.md" ]]
}

@test "adapter_text body preserved verbatim after frontmatter" {
  printf "Title here\n\nBody paragraph.\n" | "$ROOT/adapters/text.sh"
  file="$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.md | head -1)"
  grep -q "^Body paragraph.$" "$file"
}

@test "adapter_text writes atomically (no .tmp lingers)" {
  echo "atomic test" | "$ROOT/adapters/text.sh"
  count=$(ls "$BRAIN_VAULT/$BRAIN_INBOX"/*.tmp 2>/dev/null | wc -l)
  [ "$count" -eq 0 ]
}
