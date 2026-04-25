#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP_PARENT="$(mktemp -d)"
  TMP_VAULT="$TMP_PARENT/second-brain"
  export BRAIN_VAULT_OVERRIDE="$TMP_VAULT"
}

teardown() {
  [ -d "$TMP_PARENT" ] && rm -rf "$TMP_PARENT"
}

@test "init creates the vault directory" {
  "$ROOT/pipelines/init.sh"
  [ -d "$TMP_VAULT" ]
}

@test "init creates all numbered folders" {
  "$ROOT/pipelines/init.sh"
  [ -d "$TMP_VAULT/00-Inbox" ]
  [ -d "$TMP_VAULT/10-Sources/_attachments" ]
  [ -d "$TMP_VAULT/20-Notes" ]
  [ -d "$TMP_VAULT/30-Canvases" ]
  [ -d "$TMP_VAULT/40-Bases" ]
  [ -d "$TMP_VAULT/90-Graphs" ]
}

@test "init writes brain.config.yml at vault root" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/brain.config.yml" ]
  grep -q "vault:" "$TMP_VAULT/brain.config.yml"
}

@test "init writes .gitignore" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/.gitignore" ]
  grep -q "^.qmd/" "$TMP_VAULT/.gitignore"
  grep -q "^.graphify-out/" "$TMP_VAULT/.gitignore"
}

@test "init writes README.md" {
  "$ROOT/pipelines/init.sh"
  [ -f "$TMP_VAULT/README.md" ]
}

@test "init is idempotent" {
  "$ROOT/pipelines/init.sh"
  "$ROOT/pipelines/init.sh"
  [ -d "$TMP_VAULT/00-Inbox" ]
}

@test "init does not overwrite existing brain.config.yml" {
  "$ROOT/pipelines/init.sh"
  echo "# user edited" >> "$TMP_VAULT/brain.config.yml"
  "$ROOT/pipelines/init.sh"
  grep -q "# user edited" "$TMP_VAULT/brain.config.yml"
}
