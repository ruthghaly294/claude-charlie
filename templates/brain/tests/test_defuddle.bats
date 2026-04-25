#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  if ! command -v defuddle >/dev/null; then
    skip "defuddle not installed"
  fi
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_defuddle writes a note for an HTML file source" {
  out="$("$ROOT/adapters/defuddle.sh" "$ROOT/tests/fixtures/sample.html")"
  [ -f "$out" ]
}

@test "adapter_defuddle frontmatter has type:url and source URL/path" {
  out="$("$ROOT/adapters/defuddle.sh" "$ROOT/tests/fixtures/sample.html")"
  grep -q '^type: url$' "$out"
  grep -q '^source: ' "$out"
}

@test "adapter_defuddle aborts on empty arg" {
  run "$ROOT/adapters/defuddle.sh" ""
  [ "$status" -ne 0 ]
}
