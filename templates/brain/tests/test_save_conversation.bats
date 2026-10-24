#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  TRANSCRIPT="$ROOT/tests/fixtures/sample-transcript.jsonl"
}

teardown() {
  teardown_brain_temp_vault
}

@test "save-conversation writes a markdown file in conversations/" {
  payload="$(jq -n --arg p "$TRANSCRIPT" --arg s "abc12345-test-session-id" \
    '{transcript_path:$p, session_id:$s, hook_event_name:"Stop"}')"
  echo "$payload" | "$ROOT/hooks/save-conversation.sh"

  count=$(find "$BRAIN_VAULT/00-Inbox/conversations" -name '*.md' 2>/dev/null | wc -l)
  [ "$count" -eq 1 ]
}

@test "save-conversation filename includes session id (idempotent)" {
  payload="$(jq -n --arg p "$TRANSCRIPT" --arg s "abc12345-deadbeef" \
    '{transcript_path:$p, session_id:$s, hook_event_name:"Stop"}')"
  echo "$payload" | "$ROOT/hooks/save-conversation.sh"
  echo "$payload" | "$ROOT/hooks/save-conversation.sh"   # second run

  count=$(find "$BRAIN_VAULT/00-Inbox/conversations" -name '*abc12345*.md' | wc -l)
  [ "$count" -eq 1 ]
}

@test "save-conversation file has frontmatter with session id and type" {
  payload="$(jq -n --arg p "$TRANSCRIPT" --arg s "session-xyz-9999" \
    '{transcript_path:$p, session_id:$s, hook_event_name:"Stop"}')"
  echo "$payload" | "$ROOT/hooks/save-conversation.sh"
  file="$(find "$BRAIN_VAULT/00-Inbox/conversations" -name '*.md' | head -1)"
  grep -q '^type: conversation$' "$file"
  grep -q '^session_id: session-xyz-9999$' "$file"
}

@test "save-conversation includes user and assistant turns" {
  payload="$(jq -n --arg p "$TRANSCRIPT" --arg s "session-content-test" \
    '{transcript_path:$p, session_id:$s, hook_event_name:"Stop"}')"
  echo "$payload" | "$ROOT/hooks/save-conversation.sh"
  file="$(find "$BRAIN_VAULT/00-Inbox/conversations" -name '*.md' | head -1)"
  grep -q '^## User' "$file"
  grep -q '^## Assistant' "$file"
}

@test "save-conversation exits 0 on missing transcript_path (no-op)" {
  payload="$(jq -n --arg s "noop" '{session_id:$s, hook_event_name:"Stop"}')"
  run bash -c "echo '$payload' | '$ROOT/hooks/save-conversation.sh'"
  [ "$status" -eq 0 ]
}

@test "save-conversation does not crash on missing session_id" {
  payload="$(jq -n --arg p "$TRANSCRIPT" '{transcript_path:$p, hook_event_name:"Stop"}')"
  run bash -c "echo '$payload' | '$ROOT/hooks/save-conversation.sh'"
  [ "$status" -eq 0 ]
}
