#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  echo "# n1" > "$BRAIN_VAULT/$BRAIN_INBOX/n1.md"
  echo "# n2" > "$BRAIN_VAULT/$BRAIN_INBOX/n2.md"
}

teardown() {
  teardown_brain_temp_vault
}

@test "status counts inbox notes" {
  out="$("$ROOT/pipelines/status.sh")"
  [[ "$out" == *"Inbox    : 2 notes"* ]]
}

@test "status reports last reindex 'never' when missing" {
  out="$("$ROOT/pipelines/status.sh")"
  [[ "$out" == *"Last reindex: never"* ]]
}
