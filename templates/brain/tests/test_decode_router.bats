#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMPV="$(mktemp -d)/vault"
  export DECODE_CONFIG="$TMPV.config.yml"
  export DECODE_SKIP_REINDEX="1"
  cat > "$DECODE_CONFIG" <<EOF
vault: $TMPV
business:
  name: "Acme"
  keywords: ["radiology"]
sources: {}
scoring: { keep_threshold: 0.35 }
execute: { top_n: 3 }
EOF
}

teardown() {
  rm -rf "$TMPV" "$DECODE_CONFIG"
}

@test "decode help prints usage without needing config" {
  run env -u DECODE_CONFIG "$ROOT/decode" help
  [ "$status" -eq 0 ]
  [[ "$output" == *"DECODE"* ]]
  [[ "$output" == *"discover"* ]]
}

@test "decode rejects unknown subcommand with exit 2" {
  run env -u DECODE_CONFIG "$ROOT/decode" bogus
  [ "$status" -eq 2 ]
  [[ "$output" == *"unknown subcommand"* ]]
}

@test "decode init bootstraps the configured vault with DECODE folders" {
  run "$ROOT/decode" init
  [ "$status" -eq 0 ]
  for d in 01-Signals 25-Insights 50-Decisions 60-Execution 70-Feedback; do
    [ -d "$TMPV/$d" ]
  done
}

@test "decode status reports business name and source flags" {
  "$ROOT/decode" init
  run "$ROOT/decode" status
  [ "$status" -eq 0 ]
  [[ "$output" == *"Acme"* ]]
  [[ "$output" == *"rss"* ]]
}

@test "decode run completes and prints a 4-panel digest" {
  "$ROOT/decode" init
  run "$ROOT/decode" run
  [ "$status" -eq 0 ]
  [[ "$output" == *"Signals"* ]]
  [[ "$output" == *"Insights"* ]]
  [[ "$output" == *"Decisions"* ]]
  [[ "$output" == *"Execution"* ]]
}
