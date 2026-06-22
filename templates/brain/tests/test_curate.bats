#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  export DECODE_VAULT="$(mktemp -d)"
  export DECODE_SIGNALS="01-Signals"
  export DECODE_KEYWORDS=$'radiology\nfrcr'
  export DECODE_KEEP_THRESHOLD="0.5"
  export DECODE_SKIP_REINDEX="1"
  SIG="$DECODE_VAULT/$DECODE_SIGNALS"
  mkdir -p "$SIG/_archive"
}

teardown() {
  [ -n "${DECODE_VAULT:-}" ] && [[ "$DECODE_VAULT" == /tmp/* ]] && rm -rf "$DECODE_VAULT"
}

mknote() { # $1 file, $2 url, $3 title, $4 body
  cat > "$SIG/$1" <<EOF
---
source: rss
title: "$3"
url: $2
captured_at: 2026-06-05T00:00:00Z
tags: [signal, rss]
score: null
cluster: null
---

# $3

$4
EOF
}

@test "curate scores a fully-relevant signal at 1.00 and keeps it" {
  mknote a.md https://x/a "Radiology AI" "FRCR exam revision"
  run "$ROOT/pipelines/curate.sh"
  [ "$status" -eq 0 ]
  [ -f "$SIG/a.md" ]
  grep -q '^score: 1.00$' "$SIG/a.md"
  ! grep -q '^score: null$' "$SIG/a.md"
}

@test "curate archives a below-threshold signal" {
  mknote b.md https://x/b "Cooking recipes" "pasta and sauce"
  run "$ROOT/pipelines/curate.sh"
  [ "$status" -eq 0 ]
  [ ! -f "$SIG/b.md" ]
  [ -f "$SIG/_archive/b.md" ]
  grep -q '^score: 0.00$' "$SIG/_archive/b.md"
}

@test "curate keeps a signal exactly at threshold" {
  mknote c.md https://x/c "FRCR tips" "general advice"
  run "$ROOT/pipelines/curate.sh"
  [ "$status" -eq 0 ]
  [ -f "$SIG/c.md" ]
  grep -q '^score: 0.50$' "$SIG/c.md"
}

@test "curate assigns a cluster from the first matching keyword" {
  mknote c.md https://x/c "FRCR tips" "general advice"
  "$ROOT/pipelines/curate.sh"
  grep -q '^cluster: frcr$' "$SIG/c.md"
}

@test "curate dedups identical-url notes, archiving the duplicate" {
  mknote a.md https://dup/1 "Radiology one" "frcr"
  mknote a2.md https://dup/1 "Radiology two" "frcr"
  "$ROOT/pipelines/curate.sh"
  kept="$(find "$SIG" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
  [ "$kept" -eq 1 ]
  arch="$(find "$SIG/_archive" -maxdepth 1 -name '*.md' | wc -l | tr -d ' ')"
  [ "$arch" -eq 1 ]
}

@test "curate is safe to re-run (re-scores in place)" {
  mknote a.md https://x/a "Radiology AI" "FRCR exam"
  "$ROOT/pipelines/curate.sh"
  "$ROOT/pipelines/curate.sh"
  [ "$(grep -c '^score: ' "$SIG/a.md")" -eq 1 ]
  grep -q '^score: 1.00$' "$SIG/a.md"
}

@test "curate applies feedback ranking multipliers when ranking.tsv present" {
  export DECODE_FEEDBACK="70-Feedback"
  mkdir -p "$DECODE_VAULT/$DECODE_FEEDBACK"
  printf 'frcr\t1.50\n' > "$DECODE_VAULT/$DECODE_FEEDBACK/ranking.tsv"
  mknote c.md https://x/c "FRCR tips" "general advice"
  "$ROOT/pipelines/curate.sh"
  # only 'frcr' matches (1 of 2 keywords) but boosted ×1.50 → 1.50/2 = 0.75
  grep -q '^score: 0.75$' "$SIG/c.md"
}

@test "curate with no keywords keeps everything at score 1.00" {
  export DECODE_KEYWORDS=""
  mknote z.md https://x/z "Anything" "whatever"
  "$ROOT/pipelines/curate.sh"
  [ -f "$SIG/z.md" ]
  grep -q '^score: 1.00$' "$SIG/z.md"
}
