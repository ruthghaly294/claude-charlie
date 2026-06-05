#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  TMP="$(mktemp -d)"
  cat > "$TMP/decode.config.yml" <<'EOF'
vault: ~/test-brain
business:
  name: "FRCRBank"
  description: "Radiology FRCR exam preparation"
  keywords: ["FRCR", "radiology revision", "viva simulation"]
  competitors: ["https://competitor-a.com", "https://competitor-b.com"]
sources:
  rss: ["https://example.com/feed.xml"]
  reddit: { subreddits: ["Radiology"] }
  google_cse: { enabled: false }
scoring:
  keep_threshold: 0.42
execute:
  top_n: 5
EOF
}

teardown() {
  rm -rf "$TMP"
}

@test "decode_config_load expands and exports vault" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [ "$DECODE_VAULT" = "$HOME/test-brain" ]
}

@test "decode_config_load exports business name and description" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [ "$DECODE_BUSINESS_NAME" = "FRCRBank" ]
  [[ "$DECODE_BUSINESS_DESC" == *"Radiology"* ]]
}

@test "decode_config_load exports keywords newline-separated" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [[ "$DECODE_KEYWORDS" == *"FRCR"* ]]
  [[ "$DECODE_KEYWORDS" == *"viva simulation"* ]]
  [ "$(printf '%s\n' "$DECODE_KEYWORDS" | grep -c .)" -eq 3 ]
}

@test "decode_config_load exports competitors" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [[ "$DECODE_COMPETITORS" == *"competitor-a.com"* ]]
}

@test "decode_config_load reads scoring threshold and top_n" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [ "$DECODE_KEEP_THRESHOLD" = "0.42" ]
  [ "$DECODE_TOP_N" = "5" ]
}

@test "decode_config_load applies defaults for missing scoring/execute" {
  cat > "$TMP/minimal.yml" <<'EOF'
vault: ~/test-brain
business:
  name: "Acme"
EOF
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/minimal.yml"
  [ "$DECODE_KEEP_THRESHOLD" = "0.35" ]
  [ "$DECODE_TOP_N" = "3" ]
}

@test "decode_config_load exports default folder names" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [ "$DECODE_SIGNALS" = "01-Signals" ]
  [ "$DECODE_INSIGHTS" = "25-Insights" ]
  [ "$DECODE_DECISIONS" = "50-Decisions" ]
  [ "$DECODE_EXECUTION" = "60-Execution" ]
  [ "$DECODE_FEEDBACK" = "70-Feedback" ]
}

@test "decode_config_load also exports BRAIN_VAULT for inline brain calls" {
  source "$ROOT/lib/decode-config.sh"
  decode_config_load "$TMP/decode.config.yml"
  [ "$BRAIN_VAULT" = "$HOME/test-brain" ]
}

@test "decode_config_load aborts on missing file" {
  source "$ROOT/lib/decode-config.sh"
  run decode_config_load "/no/such/file.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"config not found"* ]]
}

@test "decode_config_load aborts on missing business.name" {
  echo "vault: ~/test-brain" > "$TMP/bad.yml"
  source "$ROOT/lib/decode-config.sh"
  run decode_config_load "$TMP/bad.yml"
  [ "$status" -ne 0 ]
  [[ "$output" == *"business.name"* ]]
}
