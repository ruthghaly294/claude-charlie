#!/usr/bin/env bash
# Common test helpers for brain bats tests.

setup_brain_temp_vault() {
  BRAIN_VAULT="$(mktemp -d)"
  export BRAIN_VAULT
  export BRAIN_INBOX="00-Inbox"
  export BRAIN_SOURCES="10-Sources"
  export BRAIN_GRAPHS="90-Graphs"
  mkdir -p "$BRAIN_VAULT/$BRAIN_INBOX" \
           "$BRAIN_VAULT/$BRAIN_SOURCES/_attachments" \
           "$BRAIN_VAULT/$BRAIN_GRAPHS"
}

teardown_brain_temp_vault() {
  if [ -n "${BRAIN_VAULT:-}" ] && [ -d "$BRAIN_VAULT" ] && [[ "$BRAIN_VAULT" == /tmp/* ]]; then
    rm -rf "$BRAIN_VAULT"
  fi
}

brain_root() {
  cd "$(dirname "${BATS_TEST_FILENAME}")/.." && pwd
}
