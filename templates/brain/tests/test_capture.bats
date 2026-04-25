#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
}

teardown() {
  teardown_brain_temp_vault
}

@test "capture routes plain text to text adapter" {
  out="$("$ROOT/pipelines/capture.sh" "a quick thought")"
  [ -f "$out" ]
  grep -q '^type: text$' "$out"
}

@test "capture routes existing .md path to copy adapter" {
  src="$(mktemp --suffix=.md)"
  printf -- '---\nfoo: bar\n---\n\nhello\n' > "$src"
  out="$("$ROOT/pipelines/capture.sh" "$src")"
  [ -f "$out" ]
  grep -q "^hello$" "$out"
  rm "$src"
}

@test "capture routes URL to defuddle (skipped without defuddle)" {
  if ! command -v defuddle >/dev/null; then
    skip "defuddle not installed"
  fi
  out="$("$ROOT/pipelines/capture.sh" "$ROOT/tests/fixtures/sample.html")"
  [ -f "$out" ]
}

@test "capture exits nonzero with empty input" {
  run "$ROOT/pipelines/capture.sh" ""
  [ "$status" -ne 0 ]
}
