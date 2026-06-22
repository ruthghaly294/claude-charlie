#!/usr/bin/env bats

setup() {
  load helpers.bash
  ROOT="$(brain_root)"
  export DECODE_VAULT="$(mktemp -d)"
  export DECODE_FEEDBACK="70-Feedback"
  FB="$DECODE_VAULT/$DECODE_FEEDBACK"
  mkdir -p "$FB"
}

teardown() {
  [ -n "${DECODE_VAULT:-}" ] && [[ "$DECODE_VAULT" == /tmp/* ]] && rm -rf "$DECODE_VAULT"
}

@test "feedback skips gracefully when no metrics file present" {
  run "$ROOT/pipelines/feedback.sh"
  [ "$status" -eq 0 ]
  [ ! -f "$FB/ranking.tsv" ]
}

@test "feedback turns metrics.csv into a ranking.tsv with multipliers" {
  cat > "$FB/metrics.csv" <<'EOF'
keyword,value
frcr,100
radiology,20
viva,60
EOF
  run "$ROOT/pipelines/feedback.sh"
  [ "$status" -eq 0 ]
  [ -f "$FB/ranking.tsv" ]
  # best performer gets the top multiplier (1.50), worst the floor (0.50)
  grep -qE '^frcr	1\.50$' "$FB/ranking.tsv"
  grep -qE '^radiology	0\.50$' "$FB/ranking.tsv"
  # middling keyword lands strictly between
  mid="$(awk -F'\t' '$1=="viva"{print $2}' "$FB/ranking.tsv")"
  run awk -v m="$mid" 'BEGIN{exit !(m>0.5 && m<1.5)}'
  [ "$status" -eq 0 ]
}

@test "feedback writes a human-readable ranking.md sorted best-first" {
  cat > "$FB/metrics.csv" <<'EOF'
keyword,value
frcr,100
radiology,20
EOF
  "$ROOT/pipelines/feedback.sh"
  [ -f "$FB/ranking.md" ]
  # frcr must appear before radiology in the rendered table
  frcr_line="$(grep -n 'frcr' "$FB/ranking.md" | head -1 | cut -d: -f1)"
  rad_line="$(grep -n 'radiology' "$FB/ranking.md" | head -1 | cut -d: -f1)"
  [ "$frcr_line" -lt "$rad_line" ]
}

@test "feedback parses a markdown table in metrics.md too" {
  cat > "$FB/metrics.md" <<'EOF'
| keyword | value |
| --- | --- |
| frcr | 80 |
| radiology | 10 |
EOF
  "$ROOT/pipelines/feedback.sh"
  [ -f "$FB/ranking.tsv" ]
  grep -qE '^frcr	1\.50$' "$FB/ranking.tsv"
}
