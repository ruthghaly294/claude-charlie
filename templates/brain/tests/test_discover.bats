#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  export DECODE_VAULT="$(mktemp -d)"
  export DECODE_SIGNALS="01-Signals"
  mkdir -p "$DECODE_VAULT/$DECODE_SIGNALS/_archive"
  NDJSON='{"source":"rss","title":"Radiology AI breakthrough","url":"https://example.com/a","published":"2026-06-02","author":"jane","tags":["rss"],"raw":"body one"}
{"source":"reddit","title":"Viva simulation tips","url":"https://reddit.com/r/Radiology/y","published":"","author":"user2","tags":["reddit"],"raw":""}'
}

teardown() {
  [ -n "${DECODE_VAULT:-}" ] && [[ "$DECODE_VAULT" == /tmp/* ]] && rm -rf "$DECODE_VAULT"
}

@test "discover --stdin writes one signal note per record" {
  run bash -c "printf '%s' \"\$1\" | '$ROOT/pipelines/discover.sh' --stdin" _ "$NDJSON"
  [ "$status" -eq 0 ]
  count="$(find "$DECODE_VAULT/$DECODE_SIGNALS" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
  [ "$count" -eq 2 ]
}

@test "discover writes frontmatter with required keys" {
  printf '%s' "$NDJSON" | "$ROOT/pipelines/discover.sh" --stdin
  note="$(grep -rl "Radiology AI breakthrough" "$DECODE_VAULT/$DECODE_SIGNALS" | head -1)"
  [ -n "$note" ]
  grep -q '^source: rss' "$note"
  grep -q '^url: https://example.com/a' "$note"
  grep -q '^score: null' "$note"
  grep -q '^cluster: null' "$note"
  grep -q '^captured_at: ' "$note"
}

@test "discover updates the .seen ledger" {
  printf '%s' "$NDJSON" | "$ROOT/pipelines/discover.sh" --stdin
  [ -f "$DECODE_VAULT/$DECODE_SIGNALS/.seen" ]
  [ "$(grep -c . "$DECODE_VAULT/$DECODE_SIGNALS/.seen")" -eq 2 ]
}

@test "discover is idempotent — re-running adds no duplicates" {
  printf '%s' "$NDJSON" | "$ROOT/pipelines/discover.sh" --stdin
  printf '%s' "$NDJSON" | "$ROOT/pipelines/discover.sh" --stdin
  count="$(find "$DECODE_VAULT/$DECODE_SIGNALS" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
  [ "$count" -eq 2 ]
}

@test "discover handles titles with YAML-special characters safely" {
  printf '%s\n' '{"source":"rss","title":"Cost: $5 \"deal\"","url":"https://x.test/1","tags":["rss"],"raw":""}' \
    | "$ROOT/pipelines/discover.sh" --stdin
  note="$(find "$DECODE_VAULT/$DECODE_SIGNALS" -maxdepth 1 -name '*.md' | head -1)"
  [ -n "$note" ]
  # frontmatter must still be parseable: title key present and value quoted
  grep -q '^title: ' "$note"
  run bash -c "sed -n '/^---$/,/^---$/p' '$note' | sed '1d;\$d' | yq '.title'"
  [ "$status" -eq 0 ]
  [[ "$output" == *'Cost: $5'* ]]
}
