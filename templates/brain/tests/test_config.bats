#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP="$(mktemp -d)"
  cat > "$TMP/brain.config.yml" <<'EOF'
vault: ~/test-brain
inbox: 00-Inbox
sources: 10-Sources
graphs: 90-Graphs
qmd:
  collections:
    - name: brain
      path: .
graphify:
  mode: standard
  whisper_model: base
markitdown:
  preserve_originals: true
  attachments_dir: 10-Sources/_attachments
EOF
}

teardown() {
  rm -rf "$TMP"
}

@test "config_load reads vault path" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_VAULT" = "$HOME/test-brain" ]
}

@test "config_load reads folder names" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_INBOX" = "00-Inbox" ]
  [ "$BRAIN_SOURCES" = "10-Sources" ]
  [ "$BRAIN_GRAPHS" = "90-Graphs" ]
}

@test "config_load reads graphify mode" {
  source "$ROOT/lib/config.sh"
  config_load "$TMP/brain.config.yml"
  [ "$BRAIN_GRAPHIFY_MODE" = "standard" ]
}

@test "config_load aborts on missing file" {
  source "$ROOT/lib/config.sh"
  run config_load "/no/such/file.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"config not found"* ]]
}

@test "config_load aborts on missing vault key" {
  echo "inbox: 00-Inbox" > "$TMP/bad.yml"
  source "$ROOT/lib/config.sh"
  run config_load "$TMP/bad.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"vault"* ]]
}
