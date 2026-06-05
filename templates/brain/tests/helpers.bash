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

# Put a routing `curl` stub on PATH that returns canned fixtures based on the
# requested URL. Lets scanner tests run fully offline.
decode_stub_curl() {
  local fix; fix="$(dirname "${BATS_TEST_FILENAME}")/fixtures"
  STUB_BIN="$(mktemp -d)"
  cat > "$STUB_BIN/curl" <<EOF
#!/usr/bin/env bash
for a in "\$@"; do
  case "\$a" in
    *reddit.com*)      cat "$fix/reddit_hot.json"; exit 0 ;;
    *algolia*)         cat "$fix/hn_search.json"; exit 0 ;;
    *api.github.com*)  cat "$fix/github_search.json"; exit 0 ;;
  esac
done
cat "$fix/rss_sample.xml"
EOF
  chmod +x "$STUB_BIN/curl"
  PATH="$STUB_BIN:$PATH"
  export PATH
}

decode_clean_stub_curl() {
  [ -n "${STUB_BIN:-}" ] && [[ "$STUB_BIN" == /tmp/* ]] && rm -rf "$STUB_BIN"
}
