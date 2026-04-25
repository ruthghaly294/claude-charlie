#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  setup_brain_temp_vault
  if ! command -v markitdown >/dev/null; then
    skip "markitdown not installed"
  fi
}

teardown() {
  teardown_brain_temp_vault
}

@test "adapter_markitdown converts html to markdown note" {
  out="$("$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html")"
  [ -f "$out" ]
  grep -q "Hello Markitdown" "$out"
}

@test "adapter_markitdown writes frontmatter with type matching extension" {
  out="$("$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html")"
  grep -q '^type: html$' "$out"
  grep -q '^source: ' "$out"
}

@test "adapter_markitdown preserves original under attachments_dir" {
  export BRAIN_MARKITDOWN_PRESERVE=true
  export BRAIN_MARKITDOWN_ATTACHMENTS="10-Sources/_attachments"
  "$ROOT/adapters/markitdown.sh" "$ROOT/tests/fixtures/sample.html"
  ls "$BRAIN_VAULT/10-Sources/_attachments/sample.html"
}

@test "adapter_markitdown returns nonzero on missing input" {
  run "$ROOT/adapters/markitdown.sh" "/no/such/file.pdf"
  [ "$status" -ne 0 ]
}
