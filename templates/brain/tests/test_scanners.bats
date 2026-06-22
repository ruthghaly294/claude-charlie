#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP="$(mktemp -d)"
  export DECODE_CONFIG_PATH="$TMP/decode.config.yml"
  cat > "$DECODE_CONFIG_PATH" <<'EOF'
vault: ~/test-brain
business:
  name: "Acme"
  keywords: ["radiology", "frcr"]
sources:
  rss: ["https://example.com/feed.xml"]
  github_trending: { topics: ["ai-agents"], window: "weekly" }
  reddit: { subreddits: ["Radiology"] }
  hackernews: { query: "radiology" }
  youtube: { queries: ["frcr exam"] }
  google_cse: { enabled: false }
  twitter: { enabled: false }
  producthunt: { enabled: false }
EOF
  decode_stub_curl
}

teardown() {
  decode_clean_stub_curl
  rm -rf "$TMP"
}

valid_ndjson() {
  # every non-empty line must parse as JSON
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    printf '%s' "$line" | jq -e . >/dev/null || return 1
  done <<< "$1"
}

@test "rss scanner emits valid NDJSON with feed item titles" {
  run "$ROOT/scanners/rss.sh"
  [ "$status" -eq 0 ]
  valid_ndjson "$output"
  [[ "$output" == *"Radiology AI breakthrough"* ]]
  [[ "$output" == *"FRCR exam changes 2026"* ]]
  [[ "$output" == *'"source":"rss"'* ]] || [[ "$output" == *'"source": "rss"'* ]]
}

@test "rss scanner skips when no feeds configured" {
  cat > "$DECODE_CONFIG_PATH" <<'EOF'
vault: ~/test-brain
business: { name: "Acme" }
sources: { rss: [] }
EOF
  run "$ROOT/scanners/rss.sh"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | jq -R 'select(test("^\\{"))' 2>/dev/null)" ]
}

@test "github_trending scanner emits repos from search API" {
  run "$ROOT/scanners/github_trending.sh"
  [ "$status" -eq 0 ]
  valid_ndjson "$output"
  [[ "$output" == *"acme/agent"* ]]
  [[ "$output" == *"github"* ]]
}

@test "reddit_hn scanner emits reddit posts and HN hits" {
  run "$ROOT/scanners/reddit_hn.sh"
  [ "$status" -eq 0 ]
  valid_ndjson "$output"
  [[ "$output" == *"How I passed FRCR first attempt"* ]]
  [[ "$output" == *"Show HN: Medical imaging AI"* ]]
}

@test "reddit_hn HN hit without url falls back to item permalink" {
  run "$ROOT/scanners/reddit_hn.sh"
  [ "$status" -eq 0 ]
  [[ "$output" == *"news.ycombinator.com/item?id=222"* ]]
}

@test "youtube scanner skips gracefully when yt-dlp is missing" {
  # ensure yt-dlp is not found by pointing PATH at an empty dir + coreutils
  EMPTY="$(mktemp -d)"
  run env PATH="$EMPTY:/usr/bin:/bin" DECODE_CONFIG_PATH="$DECODE_CONFIG_PATH" "$ROOT/scanners/youtube.sh"
  rm -rf "$EMPTY"
  [ "$status" -eq 0 ]
}

@test "google_cse scanner skips with a warning when keys are absent" {
  run env -u GOOGLE_CSE_KEY -u GOOGLE_CSE_ID DECODE_CONFIG_PATH="$DECODE_CONFIG_PATH" "$ROOT/scanners/google_cse.sh"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | grep '^{' || true)" ]
}

@test "twitter scanner skips with a warning when bearer token is absent" {
  run env -u TWITTER_BEARER DECODE_CONFIG_PATH="$DECODE_CONFIG_PATH" "$ROOT/scanners/twitter.sh"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | grep '^{' || true)" ]
}

@test "producthunt scanner skips with a warning when token is absent" {
  run env -u PRODUCTHUNT_TOKEN DECODE_CONFIG_PATH="$DECODE_CONFIG_PATH" "$ROOT/scanners/producthunt.sh"
  [ "$status" -eq 0 ]
  [ -z "$(printf '%s' "$output" | grep '^{' || true)" ]
}

@test "google_cse scanner emits NDJSON when enabled and key present (stubbed)" {
  cat > "$DECODE_CONFIG_PATH" <<'EOF'
vault: ~/test-brain
business: { name: "Acme", keywords: ["radiology"] }
sources:
  google_cse: { enabled: true }
EOF
  FIX="$(dirname "${BATS_TEST_FILENAME}")/fixtures"
  STUB2="$(mktemp -d)"
  cat > "$STUB2/curl" <<EOF
#!/usr/bin/env bash
cat "$FIX/google_cse.json"
EOF
  chmod +x "$STUB2/curl"
  run env PATH="$STUB2:$PATH" GOOGLE_CSE_KEY=k GOOGLE_CSE_ID=id DECODE_CONFIG_PATH="$DECODE_CONFIG_PATH" "$ROOT/scanners/google_cse.sh"
  rm -rf "$STUB2"
  [ "$status" -eq 0 ]
  valid_ndjson "$output"
  [[ "$output" == *"Radiology revision guide"* ]]
}
